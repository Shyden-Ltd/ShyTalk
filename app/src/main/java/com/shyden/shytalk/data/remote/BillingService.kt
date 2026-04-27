package com.shyden.shytalk.data.remote

import android.app.Activity
import android.content.Context
import android.util.Log
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

data class PurchaseResult(
    val productId: String,
    val purchaseToken: String,
    val isSubscription: Boolean,
    val success: Boolean,
    val errorMessage: String? = null,
)

class BillingService(
    context: Context,
) {
    companion object {
        private const val TAG = "BillingService"
    }

    private val _purchaseEvents = MutableSharedFlow<PurchaseResult>(extraBufferCapacity = 5)
    val purchaseEvents: SharedFlow<PurchaseResult> = _purchaseEvents.asSharedFlow()

    private val billingClient: BillingClient

    private val purchasesUpdatedListener =
        PurchasesUpdatedListener { billingResult, purchases ->
            if (billingResult.responseCode == BillingClient.BillingResponseCode.OK && purchases != null) {
                for (purchase in purchases) {
                    if (purchase.purchaseState == Purchase.PurchaseState.PURCHASED) {
                        val productId = purchase.products.firstOrNull() ?: continue
                        val isSub = purchase.products.any { it.startsWith("super_shy") }
                        _purchaseEvents.tryEmit(
                            PurchaseResult(
                                productId = productId,
                                purchaseToken = purchase.purchaseToken,
                                isSubscription = isSub,
                                success = true,
                            ),
                        )
                        if (!purchase.isAcknowledged) {
                            val params =
                                AcknowledgePurchaseParams
                                    .newBuilder()
                                    .setPurchaseToken(purchase.purchaseToken)
                                    .build()
                            billingClient.acknowledgePurchase(params) { ackResult ->
                                if (ackResult.responseCode != BillingClient.BillingResponseCode.OK) {
                                    Log.w(TAG, "Acknowledge failed: ${ackResult.debugMessage}")
                                }
                            }
                        }
                    }
                }
            } else if (billingResult.responseCode != BillingClient.BillingResponseCode.USER_CANCELED) {
                // Surface USER_INELIGIBLE / PAYMENT_DECLINED_DUE_TO_INSUFFICIENT_FUNDS so the
                // audit trail can distinguish a Play-blocked purchase (regulatory / parental
                // controls) from a generic billing error. NO_APPLICABLE_SUB_RESPONSE_CODE is
                // the absent-signal sentinel.
                val subCode = billingResult.onPurchasesUpdatedSubResponseCode
                val errorMessage =
                    if (subCode != BillingClient.OnPurchasesUpdatedSubResponseCode.NO_APPLICABLE_SUB_RESPONSE_CODE) {
                        "${billingResult.debugMessage} (subCode=$subCode)"
                    } else {
                        billingResult.debugMessage
                    }
                _purchaseEvents.tryEmit(
                    PurchaseResult(
                        productId = "",
                        purchaseToken = "",
                        isSubscription = false,
                        success = false,
                        errorMessage = errorMessage,
                    ),
                )
            }
        }

    init {
        billingClient =
            BillingClient
                .newBuilder(context)
                .setListener(purchasesUpdatedListener)
                .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
                .build()
    }

    @Volatile
    private var isConnected = false

    suspend fun connect(): Boolean =
        suspendCancellableCoroutine { cont ->
            if (isConnected) {
                cont.resume(true)
                return@suspendCancellableCoroutine
            }
            billingClient.startConnection(
                object : BillingClientStateListener {
                    override fun onBillingSetupFinished(result: BillingResult) {
                        isConnected = result.responseCode == BillingClient.BillingResponseCode.OK
                        if (cont.isActive) cont.resume(isConnected)
                    }

                    override fun onBillingServiceDisconnected() {
                        isConnected = false
                    }
                },
            )
        }

    fun disconnect() {
        billingClient.endConnection()
        isConnected = false
    }

    suspend fun queryProducts(
        productIds: List<String>,
        type: String = BillingClient.ProductType.INAPP,
    ): List<ProductDetails> {
        if (!connect()) return emptyList()

        val params =
            productIds.map { productId ->
                QueryProductDetailsParams.Product
                    .newBuilder()
                    .setProductId(productId)
                    .setProductType(type)
                    .build()
            }

        val queryParams =
            QueryProductDetailsParams
                .newBuilder()
                .setProductList(params)
                .build()

        return suspendCancellableCoroutine { cont ->
            billingClient.queryProductDetailsAsync(queryParams) { result, queryResult ->
                if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                    // queryProductDetailsAsync can return OK with a partial productDetailsList;
                    // the unfetched siblings are the only client-side signal of a Play-side
                    // fetch failure (mistyped / region-restricted / policy-blocked SKU). Don't
                    // drop them silently.
                    val unfetched = queryResult.unfetchedProductList
                    if (unfetched.isNotEmpty()) {
                        Log.w(
                            TAG,
                            "queryProducts: ${unfetched.size} unfetched: " +
                                unfetched.joinToString { "${it.productId}(status=${it.statusCode})" },
                        )
                    }
                    cont.resume(queryResult.productDetailsList ?: emptyList())
                } else {
                    Log.w(
                        TAG,
                        "queryProducts failed: code=${result.responseCode} msg=${result.debugMessage}",
                    )
                    cont.resume(emptyList())
                }
            }
        }
    }

    fun launchPurchaseFlow(
        activity: Activity,
        productDetails: ProductDetails,
        offerToken: String? = null,
    ): BillingResult {
        val productDetailsParams =
            BillingFlowParams.ProductDetailsParams
                .newBuilder()
                .setProductDetails(productDetails)
                .apply { if (offerToken != null) setOfferToken(offerToken) }
                .build()

        val flowParams =
            BillingFlowParams
                .newBuilder()
                .setProductDetailsParamsList(listOf(productDetailsParams))
                .build()

        return billingClient.launchBillingFlow(activity, flowParams)
    }

    suspend fun queryExistingPurchases(): List<Purchase> {
        if (!connect()) return emptyList()

        val inAppPurchases = queryPurchasesByType(BillingClient.ProductType.INAPP)
        val subPurchases = queryPurchasesByType(BillingClient.ProductType.SUBS)
        return inAppPurchases + subPurchases
    }

    // A non-OK response here previously returned silently as an empty list, which would
    // tell a returning user they don't own SuperShy when the real cause is a transient
    // SERVICE_DISCONNECTED / ITEM_UNAVAILABLE. Log the failure so the caller can at least
    // distinguish "no purchases" from "Play SDK couldn't fetch."
    private suspend fun queryPurchasesByType(type: String): List<Purchase> =
        suspendCancellableCoroutine { cont ->
            billingClient.queryPurchasesAsync(
                QueryPurchasesParams.newBuilder().setProductType(type).build(),
            ) { result, purchases ->
                if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                    Log.w(
                        TAG,
                        "queryPurchasesAsync($type) failed: code=${result.responseCode} msg=${result.debugMessage}",
                    )
                }
                cont.resume(purchases)
            }
        }
}
