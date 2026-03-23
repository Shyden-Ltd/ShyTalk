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
                _purchaseEvents.tryEmit(
                    PurchaseResult(
                        productId = "",
                        purchaseToken = "",
                        isSubscription = false,
                        success = false,
                        errorMessage = billingResult.debugMessage,
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
            billingClient.queryProductDetailsAsync(queryParams) { result, detailsList ->
                if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                    cont.resume(detailsList)
                } else {
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

        val inAppPurchases =
            suspendCancellableCoroutine<List<Purchase>> { cont ->
                billingClient.queryPurchasesAsync(
                    QueryPurchasesParams
                        .newBuilder()
                        .setProductType(BillingClient.ProductType.INAPP)
                        .build(),
                ) { _, purchases -> cont.resume(purchases) }
            }

        val subPurchases =
            suspendCancellableCoroutine<List<Purchase>> { cont ->
                billingClient.queryPurchasesAsync(
                    QueryPurchasesParams
                        .newBuilder()
                        .setProductType(BillingClient.ProductType.SUBS)
                        .build(),
                ) { _, purchases -> cont.resume(purchases) }
            }

        return inAppPurchases + subPurchases
    }
}
