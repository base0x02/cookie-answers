# Cookie Answers

A Safari extension for iPhone, iPad and Mac that answers cookie consent banners for you. By default it rejects everything except necessary cookies, and you can switch to accepting all or doing nothing, for every site or just one. It's built on DuckDuckGo's [autoconsent](https://github.com/duckduckgo/autoconsent) engine and rules (MPL-2.0).

## Install guide

The extension isn't on the App Store, so you build it yourself on a Mac and install it from there.

### What you need

- A Mac running a version of macOS that supports the current Xcode
- Xcode (check App Store)
- An Apple ID (a free one works)
- To install on a phone or tablet: an iPhone or iPad on iOS 17 or later, and a USB cable

The Mac version of the extension needs macOS 12 or later.

### Step 1: Install the tools

1. Install **Xcode** from the Mac App Store, then open it once. Accept the license and let it finish installing components. If you're installing on an iPhone or iPad, include the iOS platform when asked.
2. Install **Node.js**, which builds the extension:
   1. Go to the [Node.js download page](https://nodejs.org/en/download) and choose the **LTS** version.
   2. Download the **macOS Installer (.pkg)**. It works on both Apple silicon and Intel Macs.
   3. Open the downloaded file from your **Downloads** folder.
   4. Click through the installer with the default options, and enter your Mac password when asked.
   5. Click **Close** when it finishes. If Terminal is open, quit it and reopen it so it can find Node.js.

   If you already use [Homebrew](https://brew.sh), you can run `brew install node` instead.
3. Open **Terminal** (press **⌘ Space**, type `Terminal`, press **Return**) and check that the tools work:

   ```sh
   git --version
   node --version
   npm --version
   ```

   Each command should print a version number. If macOS asks to install the command line developer tools, click **Install**, wait for it to finish, then run the commands again. If you see `command not found: node`, quit and reopen Terminal, then try again. If that doesn't help, run the Node.js installer again.

### Step 2: Download and build the extension

Run these in Terminal:

```sh
git clone https://github.com/base0x02/cookie-answers.git
cd cookie-answers/extension
npm ci
npm run build
cd ..
```

The build creates the `extension/dist` folder, which Xcode needs. If Xcode later reports missing files in `extension/dist`, run `npm run build` again from the `extension` folder.

### Step 3: Choose your own bundle ID

Apple needs each app's ID to be unique, and the placeholder `com.example` IDs in this project may be refused. Replace `yourname` below with something of your own, using only lowercase letters and numbers, then run the command from the `cookie-answers` folder:

```sh
sed -i '' 's/com\.example\.CookieAnswers/com.yourname.CookieAnswers/g' \
  "Cookie Answers/Cookie Answers.xcodeproj/project.pbxproj" \
  "Cookie Answers/Shared (App)/ViewController.swift"
```

### Step 4: Set up signing in Xcode

1. Open the project:

   ```sh
   open "Cookie Answers/Cookie Answers.xcodeproj"
   ```

2. Go to **Xcode ▸ Settings ▸ Accounts**, click **+**, choose **Apple Account**, and sign in.
3. Close Settings. In the left sidebar, click the blue **Cookie Answers** project icon at the top.
4. Under **Targets**, select a target, open the **Signing & Capabilities** tab, turn on **Automatically manage signing**, and choose your name in the **Team** menu.
5. Repeat for the two targets you need:
   - **iPhone or iPad:** `Cookie Answers (iOS)` and `Cookie Answers Extension (iOS)`
   - **Mac:** `Cookie Answers (macOS)` and `Cookie Answers Extension (macOS)`

If Xcode says it failed to register the bundle identifier, that ID is taken. Run the command below with a different name, replacing `yourname` with the name you used in Step 3 and `newname` with the new one. Quit Xcode first.

```sh
sed -i '' 's/com\.yourname\.CookieAnswers/com.newname.CookieAnswers/g' \
  "Cookie Answers/Cookie Answers.xcodeproj/project.pbxproj" \
  "Cookie Answers/Shared (App)/ViewController.swift"
```

### Step 5: Install it

Follow the section for your device. You can do both.

#### On an iPhone or iPad

1. Connect the device to your Mac with the cable. Unlock it, and tap **Trust** if asked.
2. Turn on Developer Mode: on the device, go to **Settings ▸ Privacy & Security ▸ Developer Mode**, turn it on, and restart when asked. If the option isn't there, do steps 3 and 4 first, then come back.
3. In the bar at the top of Xcode, choose the **Cookie Answers (iOS)** scheme, then choose your device as the destination.
4. Click **Run** (the ▶ button) and wait for the build to finish.
5. If Xcode says the developer isn't trusted: on the device, go to **Settings ▸ General ▸ VPN & Device Management**, tap your Apple ID, tap **Trust**, then click **Run** again.
6. Turn on the extension in **Settings ▸ Apps ▸ Safari ▸ Extensions ▸ Cookie Answers**. On iOS 17, it's under **Settings ▸ Safari ▸ Extensions**.
7. On the same screen, set **All Websites** to **Allow**, so it can work on every site.

With a free Apple ID, the app stops working after 7 days. To renew it, connect the device and click **Run** again. A paid Apple Developer account lasts much longer.

#### On a Mac

1. In the bar at the top of Xcode, choose the **Cookie Answers (macOS)** scheme, with **My Mac** as the destination.
2. Click **Run** (the ▶ button). A small Cookie Answers window opens once the build finishes.
3. In Safari, go to **Settings ▸ Extensions** and tick **Cookie Answers**.
4. Select the extension in that list, then allow it on all websites when Safari asks for permission.

If the extension isn't in the list:

1. Go to **Safari ▸ Settings ▸ Advanced** and turn on **Show features for web developers**.
2. Turn on **Allow Unsigned Extensions**, found in the **Develop** menu or under **Settings ▸ Developer**, depending on your Safari version. Safari turns this off each time it quits, so you may need to repeat it.
3. Check **Settings ▸ Extensions** again.

### Step 6: Choose how it answers banners

Open a website in Safari, then open the extension's popup: the Cookie Answers icon in the toolbar on a Mac, or the page menu in the address bar on iPhone and iPad.

- **Cookie banners:** Reject (necessary cookies only, the default), Accept all, or Do nothing.
- **Per-site override:** a different choice for the site you're on.
- **Unrecognised banners:** how far it goes on banners it has no rule for. This only applies in Reject mode.

### Updating

To get the latest version, run these from the `cookie-answers` folder. The stash commands keep your bundle ID change safe during the update.

```sh
git stash
git pull
git stash pop
cd extension
npm ci
npm run build
cd ..
```

Then click **Run** in Xcode again for each device.
