package app.irondesk.health

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HealthAccessPolicyTest {

    @Test fun `requests only the record types selected by the athlete`() {
        val onlySleepAndWeight = Selection(
            steps = false,
            sleep = true,
            restingHr = false,
            hrv = false,
            weight = true,
            activeCalories = false,
            distance = false,
            sessions = false,
        )

        assertEquals(2, HealthAccessPolicy.permissionsFor(onlySleepAndWeight).size)
        assertEquals(7, HealthAccessPolicy.permissionsFor(Selection()).size)
        assertEquals(8, HealthAccessPolicy.permissionsFor(Selection(distance = true)).size)
    }

    @Test fun `partial grants keep authorized selections and disable only denied types`() {
        val selection = Selection(
            steps = true,
            sleep = true,
            restingHr = false,
            hrv = false,
            weight = true,
            activeCalories = false,
            distance = false,
            sessions = false,
        )
        val granted = HealthAccessPolicy.permissionsFor(selection.copy(sleep = false))

        val authorized = HealthAccessPolicy.authorizedSelection(selection, granted)

        assertEquals(2, HealthAccessPolicy.permissionsFor(authorized).size)
        assertEquals(1, HealthAccessPolicy.missingLabels(selection, granted).size)
        assertTrue(authorized.steps)
        assertFalse(authorized.sleep)
        assertTrue(authorized.weight)
    }

    @Test fun `an empty selection requests no health data`() {
        val empty = Selection(
            steps = false,
            sleep = false,
            restingHr = false,
            hrv = false,
            weight = false,
            activeCalories = false,
            distance = false,
            sessions = false,
        )

        assertTrue(HealthAccessPolicy.permissionsFor(empty).isEmpty())
        assertTrue(HealthAccessPolicy.missingLabels(empty, emptySet()).isEmpty())
    }
}
