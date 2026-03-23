package com.shyden.shytalk.core.util

import android.content.Context
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.media.MediaMuxer
import android.net.Uri
import android.view.Surface
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

object VideoCompressor {
    suspend fun compressVideo(
        context: Context,
        uri: Uri,
        targetSizeBytes: Long,
        originalMimeType: String = "video/mp4",
    ): Pair<ByteArray, String>? =
        withContext(Dispatchers.Default) {
            try {
                // Check source size — if already under target, return raw bytes
                val rawBytes =
                    context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                        ?: return@withContext null
                if (rawBytes.size <= targetSizeBytes) {
                    return@withContext rawBytes to originalMimeType
                }

                // Get video metadata
                val retriever = MediaMetadataRetriever()
                try {
                    context.contentResolver.openFileDescriptor(uri, "r")?.use { pfd ->
                        retriever.setDataSource(pfd.fileDescriptor)
                    }
                } catch (e: Exception) {
                    retriever.release()
                    return@withContext null
                }

                val durationMs =
                    retriever
                        .extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
                        ?.toLongOrNull() ?: run {
                        retriever.release()
                        return@withContext null
                    }
                val srcWidth =
                    retriever
                        .extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)
                        ?.toIntOrNull() ?: 1280
                val srcHeight =
                    retriever
                        .extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)
                        ?.toIntOrNull() ?: 720
                val rotation =
                    retriever
                        .extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)
                        ?.toIntOrNull() ?: 0
                retriever.release()

                if (durationMs <= 0) return@withContext null

                val durationSec = durationMs / 1000.0
                // Use 85% of target for video bitrate (leave room for audio + container overhead)
                val targetBitrate =
                    ((targetSizeBytes * 0.85 * 8) / durationSec)
                        .toInt()
                        .coerceIn(200_000, 8_000_000)

                // Scale resolution down to max 720p if larger
                val (outWidth, outHeight) = scaleToMax720p(srcWidth, srcHeight, rotation)

                val result =
                    transcode(context, uri, targetBitrate, outWidth, outHeight, rotation)
                        ?: return@withContext null
                // Guard against corrupt/empty output from partial transcode failures
                if (result.size < 1024) return@withContext null
                result to "video/mp4"
            } catch (e: Exception) {
                null
            }
        }

    private fun scaleToMax720p(
        width: Int,
        height: Int,
        rotation: Int,
    ): Pair<Int, Int> {
        // Account for rotation — if 90/270, swap for comparison
        val effectiveWidth = if (rotation == 90 || rotation == 270) height else width
        val effectiveHeight = if (rotation == 90 || rotation == 270) width else height

        val maxDim = 720
        if (effectiveWidth <= maxDim && effectiveHeight <= maxDim) {
            // Use original dimensions (before rotation swap), encoder handles rotation
            return alignTo16(width, height)
        }

        val scale = maxDim.toFloat() / maxOf(effectiveWidth, effectiveHeight)
        val scaledW = (width * scale).toInt()
        val scaledH = (height * scale).toInt()
        return alignTo16(scaledW, scaledH)
    }

    private fun alignTo16(
        w: Int,
        h: Int,
    ): Pair<Int, Int> {
        // MediaCodec requires dimensions aligned to 16; clamp to at least 16 to avoid zero-dimension crashes
        return ((w + 15) and 0x7FFFFFF0).coerceAtLeast(16) to ((h + 15) and 0x7FFFFFF0).coerceAtLeast(16)
    }

    private suspend fun transcode(
        context: Context,
        uri: Uri,
        targetBitrate: Int,
        outWidth: Int,
        outHeight: Int,
        rotation: Int,
    ): ByteArray? =
        withContext(Dispatchers.Default) {
            val tempFile = File(context.cacheDir, "compressed_${System.currentTimeMillis()}.mp4")
            var muxer: MediaMuxer? = null
            var extractor: MediaExtractor? = null
            var decoder: MediaCodec? = null
            var encoder: MediaCodec? = null

            try {
                extractor = MediaExtractor()
                context.contentResolver.openFileDescriptor(uri, "r")?.use { pfd ->
                    extractor.setDataSource(pfd.fileDescriptor)
                } ?: return@withContext null

                // Find video track
                var videoTrackIndex = -1
                var audioTrackIndex = -1
                for (i in 0 until extractor.trackCount) {
                    val format = extractor.getTrackFormat(i)
                    val mime = format.getString(MediaFormat.KEY_MIME) ?: continue
                    if (mime.startsWith("video/") && videoTrackIndex == -1) {
                        videoTrackIndex = i
                    } else if (mime.startsWith("audio/") && audioTrackIndex == -1) {
                        audioTrackIndex = i
                    }
                }

                if (videoTrackIndex == -1) return@withContext null

                extractor.selectTrack(videoTrackIndex)
                val inputFormat = extractor.getTrackFormat(videoTrackIndex)

                // Setup encoder
                val outputFormat =
                    MediaFormat
                        .createVideoFormat(
                            MediaFormat.MIMETYPE_VIDEO_AVC,
                            outWidth,
                            outHeight,
                        ).apply {
                            setInteger(MediaFormat.KEY_BIT_RATE, targetBitrate)
                            setInteger(MediaFormat.KEY_FRAME_RATE, 30)
                            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 2)
                            setInteger(
                                MediaFormat.KEY_COLOR_FORMAT,
                                MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface,
                            )
                        }

                encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
                encoder.configure(outputFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
                val inputSurface: Surface = encoder.createInputSurface()
                encoder.start()

                // Setup decoder
                val inputMime =
                    inputFormat.getString(MediaFormat.KEY_MIME)
                        ?: MediaFormat.MIMETYPE_VIDEO_AVC
                decoder = MediaCodec.createDecoderByType(inputMime)
                decoder.configure(inputFormat, inputSurface, null, 0)
                decoder.start()

                // Setup muxer
                muxer = MediaMuxer(tempFile.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
                if (rotation != 0) {
                    muxer.setOrientationHint(rotation)
                }

                var muxerVideoTrack = -1
                var muxerStarted = false
                val bufferInfo = MediaCodec.BufferInfo()
                var inputDone = false
                var decoderDone = false
                val timeoutUs = 10_000L

                // Capture as val for use inside lambda closures (avoids smart-cast issues)
                val enc = encoder
                val mux = muxer

                while (!decoderDone || !inputDone) {
                    // Feed data to decoder
                    if (!inputDone) {
                        val inputBufIndex = decoder.dequeueInputBuffer(timeoutUs)
                        if (inputBufIndex >= 0) {
                            val inputBuf = decoder.getInputBuffer(inputBufIndex) ?: continue
                            val sampleSize = extractor.readSampleData(inputBuf, 0)
                            if (sampleSize < 0) {
                                decoder.queueInputBuffer(
                                    inputBufIndex,
                                    0,
                                    0,
                                    0,
                                    MediaCodec.BUFFER_FLAG_END_OF_STREAM,
                                )
                                inputDone = true
                            } else {
                                decoder.queueInputBuffer(
                                    inputBufIndex,
                                    0,
                                    sampleSize,
                                    extractor.sampleTime,
                                    0,
                                )
                                extractor.advance()
                            }
                        }
                    }

                    // Drain decoder output → encoder input (via surface)
                    val decoderStatus = decoder.dequeueOutputBuffer(bufferInfo, timeoutUs)
                    if (decoderStatus >= 0) {
                        val render = bufferInfo.size > 0
                        decoder.releaseOutputBuffer(decoderStatus, render)
                        if (bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
                            encoder.signalEndOfInputStream()
                            decoderDone = true
                        }
                    }

                    // Drain encoder output → muxer
                    drainEncoder(enc, mux, bufferInfo, timeoutUs) {
                        if (!muxerStarted) {
                            muxerVideoTrack = mux.addTrack(enc.getOutputFormat())
                            mux.start()
                            muxerStarted = true
                        }
                        muxerVideoTrack
                    }
                }

                // Final drain
                drainEncoder(enc, mux, bufferInfo, timeoutUs, drainAll = true) { muxerVideoTrack }

                decoder.stop()
                decoder.release()
                decoder = null
                encoder.stop()
                encoder.release()
                encoder = null
                inputSurface.release()
                if (muxerStarted) {
                    muxer.stop()
                }
                muxer.release()
                muxer = null
                extractor.release()
                extractor = null

                val result = tempFile.readBytes()
                tempFile.delete()
                result
            } catch (e: Exception) {
                decoder?.runCatching {
                    stop()
                    release()
                }
                encoder?.runCatching {
                    stop()
                    release()
                }
                muxer?.runCatching {
                    stop()
                    release()
                }
                extractor?.runCatching { release() }
                tempFile.delete()
                null
            }
        }

    private fun drainEncoder(
        encoder: MediaCodec,
        muxer: MediaMuxer,
        bufferInfo: MediaCodec.BufferInfo,
        timeoutUs: Long,
        drainAll: Boolean = false,
        getTrackIndex: (Int) -> Int,
    ) {
        while (true) {
            val encoderStatus = encoder.dequeueOutputBuffer(bufferInfo, if (drainAll) timeoutUs else 0)
            if (encoderStatus == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                getTrackIndex(0)
                continue
            }
            if (encoderStatus < 0) break

            val encodedData = encoder.getOutputBuffer(encoderStatus) ?: continue
            if (bufferInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) {
                encoder.releaseOutputBuffer(encoderStatus, false)
                continue
            }

            if (bufferInfo.size > 0) {
                val trackIndex = getTrackIndex(0)
                encodedData.position(bufferInfo.offset)
                encodedData.limit(bufferInfo.offset + bufferInfo.size)
                muxer.writeSampleData(trackIndex, encodedData, bufferInfo)
            }

            encoder.releaseOutputBuffer(encoderStatus, false)

            if (bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
        }
    }
}
