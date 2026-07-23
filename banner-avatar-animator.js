/*
 * Animated 10x6 avatar bookends for the InterBBS Last Callers banner.
 *
 * The pool is the exact public collection directory used by
 * exec/avatar_chooser.js. Collection SAUCE determines where avatar data ends,
 * so descriptions/trailers are never mistaken for graphics.
 */

var COLLECTION_EXCLUDE = /\.\d+\.bin$/i;
var HUE_RING = [4, 5, 1, 3, 2, 6]; // red, magenta, blue, cyan, green, brown
var HALF_UPPER = "\xDF";
var HALF_LOWER = "\xDC";

function logMessage(logger, message) {
    if (!logger) return;
    try { logger(message); } catch (e) { }
}

function randomIndex(maximum) {
    if (maximum < 2) return 0;
    if (typeof random === "function") return random(maximum);
    return Math.floor(Math.random() * maximum);
}

function loadAvatarPool(avatarLib, logger) {
    var pool = [];
    if (!avatarLib || !avatarLib.defs || !avatarLib.size ||
        typeof avatarLib.local_library !== "function") return pool;

    var sauceLib;
    try { sauceLib = load({}, "sauce_lib.js"); }
    catch (e) { logMessage(logger, "banner avatar SAUCE load failed: " + e); return pool; }

    var files = [];
    try { files = directory(avatarLib.local_library() + "*.bin") || []; }
    catch (e2) { logMessage(logger, "banner avatar collection listing failed: " + e2); return pool; }

    for (var f = 0; f < files.length; f++) {
        var path = files[f];
        if (COLLECTION_EXCLUDE.test(file_getname(path))) continue;
        var sauce;
        try { sauce = sauceLib.read(path); } catch (e3) { sauce = null; }
        if (!sauce || !sauce.filesize || sauce.filesize < avatarLib.size) continue;

        var file = new File(path);
        if (!file.open("rb")) continue;
        var payload = "";
        try { payload = file.read(sauce.filesize) || ""; }
        finally { file.close(); }

        var count = Math.floor(payload.length / avatarLib.size);
        for (var i = 0; i < count; i++) {
            var bin = payload.substr(i * avatarLib.size, avatarLib.size);
            if (bin.length === avatarLib.size) pool.push(bin);
        }
    }
    logMessage(logger, "banner avatar pool=" + pool.length + " collections=" + files.length);
    return pool;
}

function normalizeFrameCell(cell) {
    var ch = cell && cell.ch !== undefined ? cell.ch : " ";
    if (typeof ch === "number") ch = String.fromCharCode(ch);
    ch = String(ch || " ").charAt(0);
    return { ch: ch === "\x00" ? " " : ch, attr: cell && typeof cell.attr === "number" ? cell.attr : 0 };
}

function captureRegion(frame, x, width, height) {
    var cells = [];
    for (var y = 0; y < height; y++) {
        for (var col = 0; col < width; col++) {
            cells.push(normalizeFrameCell(frame.getData(x + col, y, false)));
        }
    }
    return cells;
}

function decodeAvatar(bin, width, height) {
    var cells = [];
    for (var i = 0; i < width * height; i++) {
        var ch = bin.charAt(i * 2);
        cells.push({ ch: !ch || ch === "\x00" ? " " : ch, attr: bin.charCodeAt(i * 2 + 1) || 0 });
    }
    return cells;
}

function rotateColor(color, shift) {
    if (!shift) return color;
    var bright = color & 8;
    var base = color & 7;
    var at = HUE_RING.indexOf(base);
    if (at < 0) return color; // preserve black and gray/white neutrals
    return HUE_RING[(at + shift) % HUE_RING.length] | bright;
}

function paletteAttr(attr, shift) {
    attr = attr & 0x7F; // public chooser rejects blink; never introduce it here
    if (!shift) return attr;
    var fg = rotateColor(attr & 0x0F, shift);
    var bg = rotateColor((attr >> 4) & 0x07, shift) & 0x07;
    return fg | (bg << 4);
}

function shuffledRanks(count) {
    var indexes = [], ranks = [];
    for (var i = 0; i < count; i++) indexes.push(i);
    for (var end = count - 1; end > 0; end--) {
        var swap = randomIndex(end + 1);
        var value = indexes[end]; indexes[end] = indexes[swap]; indexes[swap] = value;
    }
    for (var rank = 0; rank < count; rank++) ranks[indexes[rank]] = rank;
    return ranks;
}

function createSide(frame, x, width, height, nextAt) {
    return {
        frame: frame,
        x: x,
        width: width,
        height: height,
        current: captureRegion(frame, x, width, height),
        currentPoolIndex: -1,
        currentPalette: 0,
        next: null,
        nextPoolIndex: -1,
        nextPalette: 0,
        ranks: [],
        transitionAt: 0,
        nextAt: nextAt,
        generation: 0
    };
}

function choosePoolIndex(pool, side, other) {
    if (!pool.length) return -1;
    var selected = randomIndex(pool.length);
    for (var tries = 0; tries < 12; tries++) {
        if (selected !== side.currentPoolIndex && (!other || selected !== other.currentPoolIndex)) return selected;
        selected = randomIndex(pool.length);
    }
    return selected;
}

function paintCell(side, index, cell, palette) {
    var x = side.x + (index % side.width);
    var y = Math.floor(index / side.width);
    side.frame.setData(x, y, cell.ch, paletteAttr(cell.attr, palette), false);
}

function seedSide(side, other, pool) {
    var selected = choosePoolIndex(pool, side, other);
    if (selected < 0) return;
    side.currentPoolIndex = selected;
    side.current = decodeAvatar(pool[selected], side.width, side.height);
    side.currentPalette = 1 + randomIndex(HUE_RING.length - 1);
    for (var i = 0; i < side.current.length; i++) {
        paintCell(side, i, side.current[i], side.currentPalette);
    }
}

function paintDissolveCell(side, index, oldCell, nextCell) {
    var oldAttr = paletteAttr(oldCell.attr, side.currentPalette);
    var nextAttr = paletteAttr(nextCell.attr, side.nextPalette);
    var oldColor = oldAttr & 0x0F;
    var nextColor = nextAttr & 0x0F;
    var upper = ((index + side.generation) & 1) === 0;
    var attr = upper
        ? nextColor | ((oldColor & 7) << 4)
        : oldColor | ((nextColor & 7) << 4);
    paintCell(side, index, { ch: upper ? HALF_UPPER : HALF_LOWER, attr: attr }, 0);
}

function beginTransition(side, other, pool, now, intervalMs) {
    var selected = choosePoolIndex(pool, side, other);
    if (selected < 0) return;
    side.nextPoolIndex = selected;
    side.next = decodeAvatar(pool[selected], side.width, side.height);
    side.nextPalette = 1 + randomIndex(HUE_RING.length - 1);
    side.ranks = shuffledRanks(side.width * side.height);
    side.transitionAt = now;
    side.generation++;
    do { side.nextAt += intervalMs; } while (side.nextAt <= now);
}

function renderTransition(side, now, dissolveMs) {
    var progress = Math.max(0, Math.min(1, (now - side.transitionAt) / dissolveMs));
    var count = side.width * side.height;
    var frontier = 0.16;
    for (var i = 0; i < count; i++) {
        var threshold = side.ranks[i] / count;
        if (threshold <= progress) paintCell(side, i, side.next[i], side.nextPalette);
        else if (threshold <= progress + frontier) paintDissolveCell(side, i, side.current[i], side.next[i]);
        else paintCell(side, i, side.current[i], side.currentPalette);
    }
    if (progress < 1) return;
    side.current = side.next;
    side.currentPoolIndex = side.nextPoolIndex;
    side.currentPalette = side.nextPalette;
    side.next = null;
    side.nextPoolIndex = -1;
}

function create(options) {
    options = options || {};
    var frame = options.frame;
    var avatarLib = options.avatarLib;
    if (!frame || !avatarLib || !avatarLib.defs) return null;
    var width = avatarLib.defs.width || 10;
    var height = avatarLib.defs.height || 6;
    if (frame.width < width * 2 || frame.height < height) return null;

    var pool = loadAvatarPool(avatarLib, options.logger);
    if (!pool.length) return null;
    var intervalMs = Math.max(1000, options.intervalMs || 5000);
    var offsetMs = Math.max(0, Math.min(intervalMs - 1,
        options.offsetMs === undefined ? Math.floor(intervalMs / 2) : options.offsetMs));
    var dissolveMs = Math.max(120, Math.min(intervalMs - 100, options.dissolveMs || 900));
    var startMs = options.startMs === undefined ? Date.now() : options.startMs;

    var left = createSide(frame, 0, width, height, startMs + intervalMs);
    var right = createSide(frame, frame.width - width, width, height, startMs + offsetMs);
    // Every launch starts with a fresh, distinct pair from the chooser pool;
    // the embedded BIN avatars are only a graceful fallback if loading fails.
    seedSide(left, null, pool);
    seedSide(right, left, pool);

    return {
        poolSize: pool.length,
        tick: function (now) {
            now = now === undefined ? Date.now() : now;
            if (!left.next && now >= left.nextAt) beginTransition(left, right, pool, now, intervalMs);
            if (!right.next && now >= right.nextAt) beginTransition(right, left, pool, now, intervalMs);
            if (left.next) renderTransition(left, now, dissolveMs);
            if (right.next) renderTransition(right, now, dissolveMs);
        }
    };
}

this;
