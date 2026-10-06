const textEncoder = new TextEncoder();

export function createZipBlob(files) {
    const entries = files.map(({ name, content }) => {
        const nameBytes = textEncoder.encode(name);
        const contentBytes = typeof content === "string" ? textEncoder.encode(content) : content;
        return {
            nameBytes,
            contentBytes,
            crc: crc32(contentBytes),
            offset: 0
        };
    });

    const parts = [];
    let offset = 0;

    for (const entry of entries) {
        entry.offset = offset;
        const header = new Uint8Array(30 + entry.nameBytes.length);
        const view = new DataView(header.buffer);
        view.setUint32(0, 0x04034b50, true);
        view.setUint16(4, 20, true);
        view.setUint16(6, 0x0800, true);
        view.setUint32(14, entry.crc, true);
        view.setUint32(18, entry.contentBytes.length, true);
        view.setUint32(22, entry.contentBytes.length, true);
        view.setUint16(26, entry.nameBytes.length, true);
        header.set(entry.nameBytes, 30);
        parts.push(header, entry.contentBytes);
        offset += header.length + entry.contentBytes.length;
    }

    const centralDirectoryOffset = offset;
    for (const entry of entries) {
        const header = new Uint8Array(46 + entry.nameBytes.length);
        const view = new DataView(header.buffer);
        view.setUint32(0, 0x02014b50, true);
        view.setUint16(4, 20, true);
        view.setUint16(6, 20, true);
        view.setUint16(8, 0x0800, true);
        view.setUint32(16, entry.crc, true);
        view.setUint32(20, entry.contentBytes.length, true);
        view.setUint32(24, entry.contentBytes.length, true);
        view.setUint16(28, entry.nameBytes.length, true);
        view.setUint32(42, entry.offset, true);
        header.set(entry.nameBytes, 46);
        parts.push(header);
        offset += header.length;
    }

    const endRecord = new Uint8Array(22);
    const endView = new DataView(endRecord.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(8, entries.length, true);
    endView.setUint16(10, entries.length, true);
    endView.setUint32(12, offset - centralDirectoryOffset, true);
    endView.setUint32(16, centralDirectoryOffset, true);
    parts.push(endRecord);

    return new Blob(parts, { type: "application/zip" });
}

function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) {
            crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}
