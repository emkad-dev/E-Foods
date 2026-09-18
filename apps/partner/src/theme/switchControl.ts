/*
 * Deliberately free of imports. It lives apart from screenChrome -- which
 * pulls the palette, and through it react-native -- so the decision below can
 * be unit-tested without a renderer.
 */
/**
 * Height for every `<Switch>` in the partner console.
 *
 * WHY IT EXISTS: none of the five call sites passed a style, so they took
 * react-native-web's fallback -- `height = styleHeight || '20px'`, with
 * `width = height * 2` (exports/Switch/index.js). A 20x40 control, on
 * "Available for ordering", "Customers can collect", "Published" and "Open":
 * the four toggles that decide whether a restaurant can trade. 20pt fails even
 * WCAG 2.5.8's 24x24, which is the LENIENT floor.
 *
 * WHY 28 AND NOT 44: a switch is sized by convention, not by the 44pt tap
 * floor -- iOS ships 31x51 and a 44x88 switch would read as a mistake. 28
 * clears 24x24 with margin and lands near the platform norm. The library
 * scales the thumb and the track radius from this one number, so nothing else
 * needs setting.
 *
 * This is a web fix in practice: the native Switch is a platform control that
 * ignores height, and partner.feasty.com.ng is where the 20pt version shipped.
 */
export const SWITCH_HEIGHT = 28;

/** Spread onto every partner `<Switch>`; see SWITCH_HEIGHT. */
export const switchControlStyle = { height: SWITCH_HEIGHT };

/**
 * The grey the switch wears when it is off. Hard-coded at all five call sites
 * before this, as Tailwind's gray-300 and gray-100 -- literals from a design
 * system this repo does not use. Kept as the same two values (this is not a
 * restyle) but named once instead of ten times.
 */
export const SWITCH_OFF_TRACK = '#d1d5db';
export const SWITCH_OFF_THUMB = '#f3f4f6';

/**
 * Colour props for a partner `<Switch>`.
 *
 * WHY THIS IS NOT JUST `thumbColor={on ? a : b}`, which is what every call site
 * had. From react-native-web's Switch (exports/Switch/index.js):
 *
 *     const thumbCurrentColor = value
 *       ? (activeThumbColor ?? '#009688')
 *       : (thumbColor ?? '#FAFAFA');
 *
 * On web `thumbColor` is read ONLY in the off state. The on state falls through
 * to `activeThumbColor` -- a react-native-web prop with no equivalent in React
 * Native's Switch API, so nothing in this repo was passing it. Every switched-on
 * toggle in the partner console was therefore rendering in Material Teal
 * #009688: "Available for ordering", "Customers can collect", "Visible to
 * customers", "Store open now". Measured on the running console, not inferred.
 *
 * It was also the worse colour on its own track: teal on `accentSoft` is 2.73:1,
 * under the 3:1 WCAG 1.4.11 asks of a control's state, where the brand green is
 * 3.81:1. Being off-brand and being illegible had the same cause.
 *
 * Both props are returned. `thumbColor` is still correct on native, where
 * Android's Switch reads it in both states and `activeThumbColor` is simply an
 * unknown prop that goes nowhere; `activeThumbColor` is what web actually uses.
 * That covers both platforms with no Platform branch.
 *
 * The off pairing is left alone on purpose: a near-white thumb on a light grey
 * track is 1.34:1, but it is also what every platform ships, it carries a drop
 * shadow, and the signal that reads off-vs-on is the TRACK changing colour, not
 * the thumb standing out against it.
 */
export const switchColorProps = (value: boolean, activeTrack: string, activeThumb: string) => ({
  trackColor: { false: SWITCH_OFF_TRACK, true: activeTrack },
  thumbColor: value ? activeThumb : SWITCH_OFF_THUMB,
  activeThumbColor: activeThumb,
});
