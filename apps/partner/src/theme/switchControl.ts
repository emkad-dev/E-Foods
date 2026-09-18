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
