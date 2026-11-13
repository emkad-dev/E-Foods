// Expo config plugin: keeps the FEASTY notification sounds through Android
// resource shrinking.
//
// WHY. Release builds set android.enableShrinkResourcesInReleaseBuilds=true.
// The sounds in res/raw are looked up only by a name built at runtime
// (expo-notifications' SoundResolver calls getIdentifier with the file name
// from JS), so the shrinker sees no reference and can empty or drop them. A
// channel's sound is fixed when Android first creates it, so a build that
// shipped without the files would create the sounded channels silent for good.
// res/raw/keep.xml with tools:keep is Android's documented way to keep them.
//
// The committed android/ projects already carry res/raw/keep.xml (EAS builds
// them without prebuild). This plugin writes the same file on any prebuild,
// beside the sounds the expo-notifications plugin copies, so a regenerated
// android/ project keeps it too.
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

const KEEP_XML = `<?xml version="1.0" encoding="utf-8"?>
<!--
  Keeps the FEASTY notification sounds through release resource shrinking:
  they are looked up only by a runtime name (expo-notifications SoundResolver),
  so the shrinker cannot see they are used. Written by
  scripts/expo/withKeepNotificationSounds.js; not packaged into the app.
-->
<resources xmlns:tools="http://schemas.android.com/tools" tools:keep="@raw/feasty_*" />
`;

const withKeepNotificationSounds = (config) =>
  withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const rawDir = path.join(modConfig.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'raw');
      fs.mkdirSync(rawDir, { recursive: true });
      fs.writeFileSync(path.join(rawDir, 'keep.xml'), KEEP_XML);
      return modConfig;
    },
  ]);

module.exports = withKeepNotificationSounds;
module.exports.KEEP_XML = KEEP_XML;
