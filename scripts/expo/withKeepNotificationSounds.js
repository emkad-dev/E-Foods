// Expo config plugin: keeps the FEASTY notification sounds through Android
// resource shrinking.
//
// WHY. Release builds set android.enableShrinkResourcesInReleaseBuilds=true.
// The sounds in res/raw are looked up only by a name built at runtime
// (expo-notifications' SoundResolver calls getIdentifier with the file name
// from JS), so the shrinker sees no reference and can empty or drop them. A
// channel's sound is fixed when Android first creates it, so a build that
// shipped without the files would create the sounded channels silent for good.
// An XML file in res/raw with tools:keep is Android's documented way to keep
// them.
//
// NOT named keep.xml: React Native's release bundling task generates its own
// res/raw/keep.xml (for the bundled JS assets) and that generated file wins the
// resource merge, so a keep.xml of ours is silently dropped and the sounds are
// shrunk away. That happened in customer vc20 / partner vc19 (2026-11-14). Any
// file name works for tools:keep, so ours has its own.
//
// The committed android/ projects already carry the file (EAS builds them
// without prebuild). This plugin writes the same file on any prebuild, beside
// the sounds the expo-notifications plugin copies, so a regenerated android/
// project keeps it too.
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

const KEEP_FILE_NAME = 'notification_sounds_keep.xml';

const KEEP_XML = `<?xml version="1.0" encoding="utf-8"?>
<!--
  Keeps the FEASTY notification sounds through release resource shrinking:
  they are looked up only by a runtime name (expo-notifications SoundResolver),
  so the shrinker cannot see they are used. Written by
  scripts/expo/withKeepNotificationSounds.js. Not named keep.xml on purpose:
  React Native's release bundling generates its own res/raw/keep.xml.
-->
<resources xmlns:tools="http://schemas.android.com/tools" tools:keep="@raw/feasty_*" />
`;

const withKeepNotificationSounds = (config) =>
  withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const rawDir = path.join(modConfig.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'raw');
      fs.mkdirSync(rawDir, { recursive: true });
      fs.writeFileSync(path.join(rawDir, KEEP_FILE_NAME), KEEP_XML);
      return modConfig;
    },
  ]);

module.exports = withKeepNotificationSounds;
module.exports.KEEP_XML = KEEP_XML;
module.exports.KEEP_FILE_NAME = KEEP_FILE_NAME;
