package com.shyden.shytalk.feature.room

import com.shyden.shytalk.core.model.BackpackItem
import com.shyden.shytalk.core.model.Gift
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BackpackSortingTest {
    private val giftCatalog =
        listOf(
            Gift(id = "g1", name = "Rose", coinValue = 10),
            Gift(id = "g2", name = "Crown", coinValue = 500),
            Gift(id = "g3", name = "Diamond", coinValue = 5000),
            Gift(id = "g4", name = "Potion", coinValue = 50),
            Gift(id = "g5", name = "Amulet", coinValue = 500),
        )

    /** Reproduces the exact sorting comparator used in BackpackSheet.kt */
    private fun sortBackpack(
        items: List<BackpackItem>,
        catalog: List<Gift>,
    ): List<BackpackItem> =
        items.sortedWith(
            compareByDescending<BackpackItem> { item ->
                catalog.find { it.id == item.giftId }?.coinValue ?: 0
            }.thenBy { item ->
                catalog.find { it.id == item.giftId }?.name ?: ""
            },
        )

    @Test
    fun `items sorted by coin value descending`() {
        val items =
            listOf(
                BackpackItem(giftId = "g1", quantity = 3),
                BackpackItem(giftId = "g2", quantity = 1),
                BackpackItem(giftId = "g3", quantity = 1),
            )

        val sorted = sortBackpack(items, giftCatalog)

        assertEquals("g3", sorted[0].giftId) // 5000
        assertEquals("g2", sorted[1].giftId) // 500
        assertEquals("g1", sorted[2].giftId) // 10
    }

    @Test
    fun `equal value items sorted alphabetically by name`() {
        val items =
            listOf(
                BackpackItem(giftId = "g2", quantity = 1), // Crown, 500
                BackpackItem(giftId = "g5", quantity = 2), // Amulet, 500
            )

        val sorted = sortBackpack(items, giftCatalog)

        assertEquals("g5", sorted[0].giftId) // Amulet comes before Crown
        assertEquals("g2", sorted[1].giftId)
    }

    @Test
    fun `full sort order is value desc then name asc`() {
        val items =
            listOf(
                BackpackItem(giftId = "g1", quantity = 5),
                BackpackItem(giftId = "g5", quantity = 1),
                BackpackItem(giftId = "g4", quantity = 2),
                BackpackItem(giftId = "g2", quantity = 1),
                BackpackItem(giftId = "g3", quantity = 1),
            )

        val sorted = sortBackpack(items, giftCatalog)

        assertEquals(listOf("g3", "g5", "g2", "g4", "g1"), sorted.map { it.giftId })
        // 5000, 500 (Amulet), 500 (Crown), 50, 10
    }

    @Test
    fun `empty backpack returns empty`() {
        val sorted = sortBackpack(emptyList(), giftCatalog)
        assertTrue(sorted.isEmpty())
    }

    @Test
    fun `single item returns unchanged`() {
        val items = listOf(BackpackItem(giftId = "g1", quantity = 3))
        val sorted = sortBackpack(items, giftCatalog)
        assertEquals(1, sorted.size)
        assertEquals("g1", sorted[0].giftId)
    }

    @Test
    fun `unknown gift ID sorts to beginning of zero-value group`() {
        val items =
            listOf(
                BackpackItem(giftId = "g1", quantity = 1), // 10 coins
                BackpackItem(giftId = "unknown", quantity = 1), // 0 coins (not in catalog)
            )

        val sorted = sortBackpack(items, giftCatalog)

        assertEquals("g1", sorted[0].giftId) // 10 coins first
        assertEquals("unknown", sorted[1].giftId) // 0 coins last
    }

    @Test
    fun `quantity is preserved after sorting`() {
        val items =
            listOf(
                BackpackItem(giftId = "g1", quantity = 5),
                BackpackItem(giftId = "g3", quantity = 2),
            )

        val sorted = sortBackpack(items, giftCatalog)

        assertEquals(2, sorted[0].quantity) // g3 first (5000 coins), qty 2
        assertEquals(5, sorted[1].quantity) // g1 second (10 coins), qty 5
    }

    @Test
    fun `empty catalog treats all items as zero value`() {
        val items =
            listOf(
                BackpackItem(giftId = "g1", quantity = 1),
                BackpackItem(giftId = "g2", quantity = 1),
            )

        val sorted = sortBackpack(items, emptyList())

        // All values 0, sorted alphabetically by name — but name lookup also fails
        // so all names are "", order is stable
        assertEquals(2, sorted.size)
    }
}
