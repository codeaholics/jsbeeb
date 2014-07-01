function loadData(url) {
    "use strict";
    var request = new XMLHttpRequest();
    request.open("GET", url, false);
    request.overrideMimeType('text/plain; charset=x-user-defined');
    request.send(null);
    if (request.status != 200) return null;
    if (typeof(request.response) != "string") {
        return request.response;
    }
    var stringData = request.response;
    var len = stringData.length;
    var data = new Uint8Array(len);
    for (var i = 0; i < len; ++i) data[i] = stringData.charCodeAt(i) & 0xff;
    return data;
}

function readInt32(data, offset) {
    "use strict";
    var request = new XMLHttpRequest();
    return (data[offset + 3] << 24) 
        | (data[offset + 2] << 16) 
        | (data[offset + 1] << 8) 
        | (data[offset + 0]);
}

function readInt16(data, offset) {
    "use strict";
    var request = new XMLHttpRequest();
    return (data[offset + 1] << 8) 
        | (data[offset + 0]);
}

function ungzip(data) {
    "use strict";
    var request = new XMLHttpRequest();
    var dataOffset = 10;
    if (data[3] & 0x02) dataOffset += 2; // Header CRC
    if (data[3] & 0x04) {
        dataOffset += 2 + readInt16(data, dataOffset); // FEXTRA
    }
    if (data[3] & 0x08) {
        while (data[dataOffset] !== 0) dataOffset++; // FILENAME
        dataOffset++;
    }
    if (data[3] & 0x10) {
        while (data[dataOffset] !== 0) dataOffset++; // FCOMMENT
        dataOffset++;
    }
    var tinf = new TINF();
    tinf.init();
    var uncompressedSize = readInt32(data, data.length - 4);
    var result = tinf.uncompress(data, dataOffset, uncompressedSize);
    if (result.status === 0) return result.data;
    throw "Unable to ungzip"; 
}

function DataStream(name_, data_, dontUnzip_) {
    "use strict";
    var request = new XMLHttpRequest();
    var self = this;
    self.name = name_;
    self.pos = 0;
    self.data = data_;
    if (!dontUnzip_ && self.data
            && self.data.length > 4 
            && self.data[0] === 0x1f 
            && self.data[1] === 0x8b 
            && self.data[2] === 0x08) {
        self.data = ungzip(self.data);
    }
    if (!self.data) {
        throw new Error("No data");
    }

    self.end = self.data.length;

    self.bytesLeft = function() {
        return self.end - self.pos;
    };

    self.eof = function() {
        return self.bytesLeft() === 0;
    };
    
    self.advance = function(distance) {
        if (self.bytesLeft() < distance) throw new RangeError("EOF in " + self.name);
        self.pos += distance;
        return self.pos - distance;
    };

    self.readInt32 = function(pos) {
        if (pos === undefined) pos = self.advance(4);
        return readInt32(self.data, pos);
    };

    self.readInt16 = function(pos) {
        if (pos === undefined) pos = self.advance(2);
        return readInt16(self.data, pos);
    };

    self.readByte = function(pos) {
        if (pos === undefined) pos = self.advance(1);
        return self.data[pos];
    };

    self.readNulString = function(pos) {
        var posToUse = pos === undefined ? self.pos : pos;
        var result = "";
        var c;
        while ((c = self.readByte(posToUse++)) !== 0) {
            result += String.fromCharCode(c);
        }
        if (pos === undefined) self.pos = posToUse;
        return result;
    };

    self.substream = function(posOrLength, length) {
        var pos;
        if (length === undefined) {
            length = posOrLength;
            pos = self.advance(length);
        } else {
            pos = posOrLength;
            if (pos + length >= self.end) throw new RangeError("EOF in " + self.name);
        }
        return new DataStream(self.name + ".sub", self.data.subarray(pos, pos + length));
    };

    self.seek = function(to) {
        if (to >= self.end) throw new RangeError("Seek out of range in " + self.name);
        self.pos = to;
    };
}