const sub = "fsx_dat" || "LOCAL-TEST_ADS".toLowerCase();

function isSysopSession() {
    return typeof user !== "undefined" && user && !!user.is_sysop;
}

function interbbsLogon() {
    if (isSysopSession()) return true;

    var entry = buildEntry();
    if (!entry) return false;

    var mb = new MsgBase(sub);
    if (!mb.open()) return false;

    var header = {
        to: "All",
        from: "IBBSLastCall",
        subject: "IBBSLastCall-Data",
        when_written_time: entry.epoch
    };
    var payload = wrapPayload(entry);
    var saved = mb.save_msg(header, payload);
    mb.close();
    return !!saved;
}

function buildEntry() {
    var now = typeof time === "function" ? time() : Math.floor(Date.now() / 1000);
    var alias = (typeof user !== "undefined" && user && (user.alias || user.name)) || "Unknown User";
    var locBits = splitLocation(typeof user !== "undefined" && user ? user.location : "");

    return {
        epoch: now,
        alias: alias,
        city: locBits.city,
        country: locBits.country || (typeof system !== "undefined" && system ? fallbackRegion(system.location) : ""),
        client: describeClient(),
        door: describeDoor(),
        bbs: describeBbs(),
        url: describeUrl(),
        system: describeSystem()
    };
}

function wrapPayload(entry) {
    var headerLine = "epoch|alias|city|country|client|door|bbs|url|system";
    var row = [
        entry.epoch,
        entry.alias,
        entry.city,
        entry.country,
        entry.client,
        entry.door,
        entry.bbs,
        entry.url,
        entry.system
    ];
    var plaintext = headerLine + "\n" + row.map(sanitizeField).join("|");
    var encoded = rot47(plaintext);
    return "BEGIN\r\n" + encoded + "\r\nEND\r\n";
}

function sanitizeField(value) {
    var str = value === undefined || value === null ? "" : String(value);
    return trim(str.replace(/[\r\n]+/g, " ").replace(/\|/g, "/"));
}

function splitLocation(raw) {
    if (!raw) return { city: "", country: "" };
    var parts = String(raw).split(",");
    var city = trim(parts.shift() || "");
    var rest = trim(parts.join(","));
    return { city: city, country: rest };
}

function fallbackRegion(raw) {
    if (!raw) return "";
    var norm = splitLocation(raw);
    return norm.country || norm.city;
}

function describeClient() {
    if (typeof client === "undefined" || !client) return "";
    var bits = [];
    if (client.protocol) bits.push(client.protocol);
    if (client.host_name) bits.push(client.host_name);
    else if (client.ip_address) bits.push(client.ip_address);
    if (client.port) bits.push("port " + client.port);
    if (typeof console !== "undefined" && console && console.terminal) bits.push(console.terminal);
    return bits.join(" ");
}

function describeDoor() {
    if (typeof js !== "undefined" && js && js.exec_file) return basename(js.exec_file);
    if (typeof bbs !== "undefined" && bbs && bbs.command_shell) return bbs.command_shell;
    return "logon";
}

function describeBbs() {
    if (typeof system === "undefined" || !system) return "";
    var name = system.name || "Unknown BBS";
    return name;
}

function describeUrl() {
    if (typeof system === "undefined" || !system) return "";
    var host = trim(system.host_name || system.inet_addr || "");
    if (!host) return "";
    var port = detectTelnetPort();
    return port ? host + ":" + port : host;
}

function detectTelnetPort() {
    if (typeof client === "undefined" || !client || !client.protocol) return 0;
    var protocol = String(client.protocol || "").toLowerCase();
    if (protocol === "telnet") return 23;
    if (protocol === "ssh") return 4022;
    return 0;
}

function describeSystem() {
    if (typeof system === "undefined" || !system) return "";
    if (system.platform) return system.platform;
    if (system.os_version) return system.os_version;
    return "";
}

function basename(path) {
    if (!path) return "";
    return String(path).replace(/\\/g, "/").replace(/^.*\//, "");
}

function trim(str) {
    return String(str || "").replace(/^\s+|\s+$/g, "");
}

function rot47(s) {
    var out = "";
    for (var i = 0; i < s.length; i++) {
        var c = s.charCodeAt(i);
        out += (c >= 33 && c <= 126)
            ? String.fromCharCode(33 + ((c - 33 + 47) % 94))
            : s.charAt(i);
    }
    return out;
}
