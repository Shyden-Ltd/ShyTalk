package com.shyden.shytalk.fake

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.BanStatus
import com.shyden.shytalk.data.repository.DeviceLockStatus
import com.shyden.shytalk.data.repository.DeviceRepository

class FakeDeviceRepository : DeviceRepository {
    var lockStatus: DeviceLockStatus = DeviceLockStatus.ALLOWED
    var banStatus: BanStatus = BanStatus()

    override suspend fun resolveDeviceLock(deviceId: String): Resource<DeviceLockStatus> = Resource.Success(lockStatus)

    override suspend fun checkBanStatus(deviceId: String): Resource<BanStatus> = Resource.Success(banStatus)
}
