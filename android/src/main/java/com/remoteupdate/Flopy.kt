package com.remoteupdate

import android.content.Context
import android.content.SharedPreferences
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import java.io.File
import org.json.JSONObject

class Flopy(private val context: Context) {
  private val flopyDir = File(context.filesDir, "flopy")
  private val metadataFile = File(flopyDir, "metadata.json")

  companion object {
    @Volatile private var instance: Flopy? = null
    fun getInstance(context: Context): Flopy =
            instance
                    ?: synchronized(this) {
                      instance ?: Flopy(context.applicationContext).also { instance = it }
                    }
  }

  private fun getPrefs(): SharedPreferences {
    return context.getSharedPreferences("flopy_metadata", Context.MODE_PRIVATE)
  }

  fun getJSBundleFile(): String? {
    val prefs = getPrefs()

    val currentPath = prefs.getString("current_path", null)
    val failedBootCount = prefs.getInt("failed_boot_count", 0)

    if (currentPath != null && currentPath.isNotEmpty() && failedBootCount < 2) {
      val bundleFile = File(currentPath)

      if (bundleFile.exists()) {
        return bundleFile.absolutePath
      }
    }

    return null
  }

  fun saveCurrentPackage(absolutePath: String, hash: String, releaseId: String) {
    val prefs = getPrefs()
    val editor = prefs.edit()

    editor.putString("previous_path", prefs.getString("current_path", null))
    editor.putString("previous_hash", prefs.getString("current_hash", null))
    editor.putString("previous_releaseId", prefs.getString("current_releaseId", null))

    editor.putString("current_path", absolutePath)
    editor.putString("current_hash", hash)
    editor.putString("current_releaseId", releaseId)
    editor.putInt("failed_boot_count", 0)

    editor.apply()
  }

  fun saveState(state: ReadableMap) {
    // Convierte el ReadableMap de JS a un String JSON y lo guarda
    val jsonString =
            state.toString() // Esto es una simplificación, la conversión real es más compleja
    getPrefs().edit().putString("full_state_json", jsonString).apply()
  }

  fun readState(): WritableMap? {
    // Lee el string JSON y lo convierte de vuelta a un WritableMap para JS
    val jsonString = getPrefs().getString("full_state_json", null)
    if (jsonString != null) {
      // Lógica para parsear el string y crear un WritableMap
      return Arguments.createMap() // Devuelve el mapa parseado
    }
    return null
  }

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
