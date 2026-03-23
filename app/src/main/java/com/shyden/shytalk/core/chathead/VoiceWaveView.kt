package com.shyden.shytalk.core.chathead

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.util.AttributeSet
import android.view.View
import android.view.animation.LinearInterpolator
import kotlin.math.sin

class VoiceWaveView
    @JvmOverloads
    constructor(
        context: Context,
        attrs: AttributeSet? = null,
        defStyleAttr: Int = 0,
    ) : View(context, attrs, defStyleAttr) {
        private val barPaint =
            Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = 0x66FFFFFF
                strokeCap = Paint.Cap.ROUND
            }

        private val clipPath = Path()
        private var animator: ValueAnimator? = null
        private var progress = 0f
        private var lastWidth = 0
        private var lastHeight = 0

        private val barCount = 5
        private val frequencies = floatArrayOf(1.0f, 1.6f, 1.2f, 1.8f, 1.4f)
        private val phases = floatArrayOf(0f, 0.8f, 1.6f, 2.4f, 3.2f)

        fun startAnimation() {
            animator?.cancel()
            animator =
                ValueAnimator.ofFloat(0f, (2 * Math.PI).toFloat()).apply {
                    duration = 2000
                    repeatCount = ValueAnimator.INFINITE
                    interpolator = LinearInterpolator()
                    addUpdateListener { anim ->
                        progress = anim.animatedValue as Float
                        invalidate()
                    }
                    start()
                }
        }

        fun stopAnimation() {
            animator?.cancel()
            animator = null
        }

        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            val w = width.toFloat()
            val h = height.toFloat()
            if (w == 0f || h == 0f) return

            // Rebuild clip path only when size changes
            if (width != lastWidth || height != lastHeight) {
                lastWidth = width
                lastHeight = height
                clipPath.reset()
                clipPath.addCircle(w / 2, h / 2, w.coerceAtMost(h) / 2, Path.Direction.CW)
            }
            canvas.save()
            canvas.clipPath(clipPath)

            val barWidth = w * 0.08f
            barPaint.strokeWidth = barWidth

            val totalBarSpan = (barCount - 1) * barWidth * 1.8f
            val startX = (w - totalBarSpan) / 2

            val minBarHeight = h * 0.08f
            val maxBarHeight = h * 0.45f
            val barBottom = h * 0.85f

            for (i in 0 until barCount) {
                val waveValue = sin((progress * frequencies[i] + phases[i]).toDouble()).toFloat()
                val normalized = (waveValue + 1f) / 2f // 0..1
                val barHeight = minBarHeight + normalized * (maxBarHeight - minBarHeight)
                val x = startX + i * barWidth * 1.8f
                canvas.drawLine(x, barBottom, x, barBottom - barHeight, barPaint)
            }

            canvas.restore()
        }

        override fun onDetachedFromWindow() {
            super.onDetachedFromWindow()
            stopAnimation()
        }
    }
