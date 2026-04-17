package com.remoteupdate

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.BufferedInputStream
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL

class Downloader(private val reactContext: ReactApplicationContext) {

    companion object {
        private const val CONNECT_TIMEOUT_MS = 30_000       // 30 segundos
        private const val READ_TIMEOUT_MS = 30_000          // 30 segundos
        private const val MAX_DOWNLOAD_TIME_MS = 5 * 60_000L // 5 minutos
    }

    /**
     * Descarga un archivo de forma asíncrona en un hilo dedicado.
     * La promesa se resuelve cuando la descarga TERMINA exitosamente,
     * o se rechaza si hay un error.
     * Emite eventos de progreso durante la descarga.
     */
    fun download(url: String, destination: String, downloadId: String, promise: Promise) {
        Thread {
            var connection: HttpURLConnection? = null
            var inputStream: BufferedInputStream? = null
            var outputStream: FileOutputStream? = null
            val startTime = System.currentTimeMillis()

            try {
                // H5: Validar esquema de URL
                val parsedUrl = URL(url)
                val scheme = parsedUrl.protocol.lowercase()
                if (scheme != "http" && scheme != "https") {
                    val errorMsg = "URL scheme no soportado: $scheme. Solo HTTP/HTTPS permitidos."
                    emitError(downloadId, errorMsg)
                    promise.reject("DOWNLOAD_ERROR", errorMsg)
                    return@Thread
                }

                connection = parsedUrl.openConnection() as HttpURLConnection
                connection.connectTimeout = CONNECT_TIMEOUT_MS
                connection.readTimeout = READ_TIMEOUT_MS
                connection.connect()

                if (connection.responseCode != HttpURLConnection.HTTP_OK) {
                    val errorMsg = "Server returned HTTP ${connection.responseCode}"
                    emitError(downloadId, errorMsg)
                    promise.reject("DOWNLOAD_ERROR", errorMsg)
                    return@Thread
                }

                val fileLength = connection.contentLength
                inputStream = BufferedInputStream(connection.inputStream)
                val file = File(destination)
                file.parentFile?.mkdirs()
                outputStream = FileOutputStream(file)

                val data = ByteArray(8192)
                var total: Long = 0
                var count: Int
                var lastProgress = 0

                while (inputStream.read(data).also { count = it } != -1) {
                    // Verificar timeout total
                    if (System.currentTimeMillis() - startTime > MAX_DOWNLOAD_TIME_MS) {
                        throw Exception("Download timed out after ${MAX_DOWNLOAD_TIME_MS / 1000}s")
                    }

                    total += count
                    outputStream.write(data, 0, count)

                    if (fileLength > 0) {
                        val progress = (total * 100 / fileLength).toInt()
                        if (progress > lastProgress) {
                            emitProgress(downloadId, progress, total, fileLength.toLong())
                            lastProgress = progress
                        }
                    }
                }

                outputStream.flush()

                emitResult(downloadId, true)
                promise.resolve(null)
            } catch (e: Exception) {
                // Limpiar archivo parcial
                try {
                    File(destination).let { if (it.exists()) it.delete() }
                } catch (_: Exception) {}

                emitError(downloadId, e.message ?: "Unknown error")
                promise.reject("DOWNLOAD_ERROR", e.message, e)
            } finally {
                try { outputStream?.close() } catch (_: Exception) {}
                try { inputStream?.close() } catch (_: Exception) {}
                try { connection?.disconnect() } catch (_: Exception) {}
            }
        }.start()
    }

    private fun emitProgress(id: String, progress: Int, bytesWritten: Long, contentLength: Long) {
        try {
            val params = Arguments.createMap().apply {
                putString("id", id)
                putInt("progress", progress)
                putDouble("bytesWritten", bytesWritten.toDouble())
                putDouble("contentLength", contentLength.toDouble())
            }
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("downloadProgress", params)
        } catch (_: Exception) {
            // Ignora errores al emitir eventos (RN puede no estar listo)
        }
    }

    private fun emitResult(id: String, success: Boolean) {
        try {
            val params = Arguments.createMap().apply {
                putString("id", id)
                putBoolean("success", success)
            }
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("downloadFinished", params)
        } catch (_: Exception) {}
    }

    private fun emitError(id: String, message: String) {
        try {
            val params = Arguments.createMap().apply {
                putString("id", id)
                putString("error", message)
            }
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("downloadError", params)
        } catch (_: Exception) {}
    }
}
