# Flopy React Native SDK

A robust, secure, and easy-to-use Over-The-Air (OTA) update system for React Native applications.

## Table of Contents
- [Installation](#installation)
- [Native Configuration](#native-configuration)
  - [Android](#android)
  - [iOS](#ios)
- [How to Use](#how-to-use)
  - [Option 1: HOC (CodePush style)](#option-1-hoc-codepush-style)
  - [Option 2: Standalone HOC](#option-2-standalone-hoc)
  - [Option 3: Provider](#option-3-provider)
- [API Reference](#api-reference)
  - [Flopy.sync()](#flopysync)
  - [Flopy.rollback()](#flopyrollback)
  - [Flopy.getUpdateMetadata()](#flopygetupdatemetadata)
- [Enums](#enums)
  - [SyncStatus](#syncstatus)
  - [InstallMode](#installmode)
- [Event Listeners](#event-listeners)
- [Advanced Configuration](#advanced-configuration)
- [Security & Stability](#security--stability)

---

## Installation

```bash
npm install flopy-react-native-sdk
# or
yarn add flopy-react-native-sdk
```

---

## Native Configuration

Flopy can be configured directly in your native projects to simplify initialization.

### Android

Add the following strings to your `android/app/src/main/res/values/strings.xml`:

```xml
<string name="flopy_server_url">https://your-flopy-server.com</string>
<string name="flopy_app_id">your-app-id</string>
<string name="flopy_channel">production</string>
<string name="flopy_deployment_key">your-deployment-key</string>
```

### iOS

Add the following keys to your `ios/YourAppName/Info.plist`:

```xml
<key>FlopyServerUrl</key>
<string>https://your-flopy-server.com</string>
<key>FlopyAppId</key>
<string>your-app-id</string>
<key>FlopyChannel</key>
<string>production</string>
<key>FlopyDeploymentKey</key>
<string>your-deployment-key</string>
```

---

## How to Use

### Option 1: HOC
The easiest way to integrate Flopy. It handles initialization, automatic syncing, and error boundaries for rollbacks.

```javascript
import Flopy from 'flopy-react-native-sdk';

const flopyOptions = {
  installMode: Flopy.InstallMode.ON_NEXT_RESTART,
};

let MyApp = () => <App />;
MyApp = Flopy.wrap(flopyOptions)(MyApp);

export default MyApp;
```

### Option 2: Standalone HOC
Identical to `Flopy.wrap`, but using a named import.

```javascript
import { flopy } from 'flopy-react-native-sdk';

let MyApp = () => <App />;
MyApp = flopy({ channel: 'staging' })(MyApp);

export default MyApp;
```

### Option 3: Provider
If you prefer a component-based approach or need more control over child components.

```javascript
import { FlopyProvider } from 'flopy-react-native-sdk';

export default function Root() {
  return (
    <FlopyProvider options={{ appId: '...' }}>
      <App />
    </FlopyProvider>
  );
}
```

---

## API Reference

### `Flopy.sync(options?: SyncOptions)`
Manually triggers an update check. Default behavior is background download and installation on next restart.

**Options:**
- `installMode`: How to install non-mandatory updates (`IMMEDIATE` or `ON_NEXT_RESTART`).
- `mandatoryInstallMode`: How to install mandatory updates.

```javascript
import Flopy, { SyncStatus } from 'flopy-react-native-sdk';

const status = await Flopy.sync({
  installMode: Flopy.InstallMode.IMMEDIATE 
});

if (status === SyncStatus.UPDATE_INSTALLED) {
  console.log("Update downloaded and installed!");
}
```

### `Flopy.rollback()`
Forcefully reverts the application to the previous version and restarts.

### `Flopy.getUpdateMetadata()`
Returns information about the current running package.

```javascript
const metadata = await Flopy.getUpdateMetadata();
console.log(metadata.releaseId, metadata.hash);
```

---

## Enums

### `SyncStatus`
- `CHECKING_FOR_UPDATE`: Searching the server.
- `DOWNLOADING`: Fetching the bundle.
- `INSTALLING`: Preparing the bundle for next start.
- `UP_TO_DATE`: No new updates found.
- `UPDATE_INSTALLED`: Update is ready and pending restart (or already applied).
- `ERROR`: Something went wrong.

### `InstallMode`
- `IMMEDIATE`: The app will restart immediately after download to apply the update.
- `ON_NEXT_RESTART`: The update is saved and will be loaded only when the user opens the app again.

---

## Event Listeners

Listen to background progress events (e.g., to show a custom progress bar).

```javascript
useEffect(() => {
  const subscription = Flopy.addListener('downloadProgress', (data) => {
    const { progress, bytesWritten, contentLength } = data;
    console.log(`Downloaded ${progress}%`);
  });

  return () => subscription.remove();
}, []);
```

Available events:
- `downloadProgress`: Incremental progress updates.
- `downloadFinished`: When the file is fully saved.
- `downloadError`: If the network or file system fails.

---

## Advanced Configuration

The `options` object passed to `wrap()`, `flopy()`, or `FlopyProvider` can include:

| Property | Type | Description |
|----------|------|-------------|
| `serverUrl` | string | URL of your Flopy server. |
| `appId` | string | Your unique Application ID. |
| `channel` | string | Remote channel (e.g., 'production', 'staging'). |
| `deploymentKey`| string | Optional security key. |
| `forceJsConfig`| boolean| If true, JS options override native XML/Plist values. |

---

## Security & Stability

Flopy is designed for production reliability:
- **HTTPS Enforcement**: In production, only HTTPS bundle URLs are allowed.
- **SHA-256 Verification**: Every bundle is hashed and verified before use.
- **Atomic Persistence**: Updates are only activated after successful integrity checks.
- **Self-Healing (Rollback)**: If the app crashes twice during startup with a new bundle, Flopy automatically reverts to the previous stable version.
- **Streaming Hashing**: iOS implementation uses streaming to prevent Out-Of-Memory crashes on large bundles.
