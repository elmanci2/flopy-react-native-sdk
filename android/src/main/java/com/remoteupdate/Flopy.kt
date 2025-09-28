package com.remoteupdate

import android.content.Context
import java.io.File
import org.json.JSONObject

/** Lógica de bajo nivel para la selección del bundle al arrancar y gestión de fallos. */
class Flopy(private val context: Context) {
  private val flopyDir = File(context.filesDir, "flopy")
  private val metadataFile = File(flopyDir, "flopy.json")

  companion object {
    @Volatile private var instance: Flopy? = null
    fun getInstance(context: Context): Flopy =
            instance
                    ?: synchronized(this) {
                      instance ?: Flopy(context.applicationContext).also { instance = it }
                    }
  }

  // Método principal llamado por MainApplication
  fun getJSBundleFile(): String? {
    if (!metadataFile.exists()) return null
    try {
      val metadata = JSONObject(metadataFile.readText())
      val currentPackage = metadata.optJSONObject("currentPackage")
      val failedBootCount = metadata.optInt("failedBootCount", 0)

      if (currentPackage != null && failedBootCount < 2) {
        val relativePath = currentPackage.getString("relativePath")
        val bundleFile = File(flopyDir, relativePath)
        if (bundleFile.exists()) {
          return bundleFile.absolutePath
        }
      }
    } catch (e: Exception) {
      e.printStackTrace()
    }
    return null
  }

  // Métodos llamados por el módulo de React Native
  fun incrementFailedBootCount() {
    if (!metadataFile.exists()) return
    try {
      val metadata = JSONObject(metadataFile.readText())
      metadata.put("failedBootCount", metadata.optInt("failedBootCount", 0) + 1)
      metadataFile.writeText(metadata.toString())
    } catch (e: Exception) {
      e.printStackTrace()
    }
  }

  fun resetFailedBootCount() {
    if (!metadataFile.exists()) return
    try {
      val metadata = JSONObject(metadataFile.readText())
      if (metadata.optInt("failedBootCount", 0) > 0) {
        metadata.put("failedBootCount", 0)
        metadataFile.writeText(metadata.toString())
      }
    } catch (e: Exception) {
      e.printStackTrace()
    }
  }
}
