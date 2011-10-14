function hexbyte(value) {
      return ((value >> 4) & 0xf).toString(16) + (value & 0xf).toString(16); 
}

function hexword(value) {
    return hexbyte(value>>8) + hexbyte(value & 0xff);
}

function signExtend(val) {
    return val >= 128 ? val - 256 : val;
}

function flags() {
    this.reset = function() {
        this.c = this.z = this.i = this.d = this.v = this.n = false;
    }
    this.debugString = function() {
        return (this.c ? "C" : "c") +
               (this.z ? "Z" : "z") +
               (this.i ? "I" : "i") +
               (this.d ? "D" : "d") +
               (this.v ? "V" : "v") +
               (this.n ? "N" : "n");
    }

    this.reset();
}

function cpu6502() {
    this.ramBank = new Uint8Array(16);
    this.memstat = [new Uint8Array(256), new Uint8Array(256)];
    this.memlook = [new Uint32Array(256), new Uint32Array(256)];
    this.ramRomOs = new Uint8Array(128 * 1024 + 2 * 16 * 16384);
    this.vis20k = 0;
    this.romOffset = 128 * 1024;
    this.osOffset = this.romOffset + 16 * 1024;
    this.a = this.x = this.y = this.s = 0;
    this.romsel = 0;

    this.readmem = function(addr) {
        if (this.debugRead) this.debugRead(addr);
        var offset = this.memlook[this.vis20k][addr >> 8];
        if (offset !== 0xffffffff) {
            return this.ramRomOs[offset + addr];
        }
        console.log("Read of " + hexword(addr));
        return null;
    }

    this.writemem = function(addr, b) {
        if (this.debugwrite) this.debugwrite(addr, b);
        if (this.memstat[this.vis20k][addr >> 8] == 1) {
            var offset = this.memlook[this.vis20k][addr >> 8];
            this.ramRomOs[offset + addr] = b;
            return;
        }
        if (addr < 0xfc00 || addr >= 0xff00) return;
        // TODO: hardware!
    }

    this.incpc = function() {
        this.pc = (this.pc + 1) & 0xffff;
    }

    this.getb = function() {
        var result = this.readmem(this.pc);
        this.incpc();
        return result;
    }

    this.getw = function() {
        var result = this.readmem(this.pc);
        this.incpc();
        result |= this.readmem(this.pc) << 8;
        this.incpc();
        return result;
    }

    this.checkInt = function() {
        this.takeInt = (this.interrupt && !this.p.i);
    }

    this.checkInt2 = function() {
        this.takeInt = ((this.interrupt & 0x80) && !this.p.i);
    }

    this.dumpregs = function() {
        console.log("6502 registers :");
        console.log("A=" + hexbyte(this.a) + " X=" + hexbyte(this.x) + " Y=" + hexbyte(this.y)
                + " S=01" + hexbyte(this.s) + " PC=" + hexword(this.pc));
        console.log("FLAGS = " + this.p.debugString());
        // console.log("ROMSEL " + hexbyte(this.romsel>>24));
    }

    this.loadOs = function(name) {
        console.log("Loading OS from " + name);
        var request = new XMLHttpRequest();
        request.open("GET", name, false);
        request.overrideMimeType('text/plain; charset=x-user-defined');
        request.send(null);
        if (request.response.length != 16384) {
            throw "Broken rom file";
        }
        for (var i = 0; i < 16384; ++i) {
            this.ramRomOs[this.osOffset + i] = request.response.charCodeAt(i) & 0xff;
        }
    }

    this.reset = function() {
        console.log("Resetting 6502");
        var i;
        for (i = 0; i < 16; ++i) this.ramBank[i] = 0;
        for (i = 0; i < 128; ++i) this.memstat[0][i] = this.memstat[1][i] = 1;
        for (i = 128; i < 256; ++i) this.memstat[0][i] = this.memstat[1][i] = 2;
        for (i = 0; i < 128; ++i) this.memlook[0][i] = this.memlook[1][i] = 0;
        /* TODO: Model A support here */
        for (i = 48; i < 128; ++i) this.memlook[1][i] = 16384;
        for (i = 128; i < 192; ++i) this.memlook[0][i] = this.memlook[1][i] = this.romOffset - 0x8000;
        for (i = 192; i < 256; ++i) this.memlook[0][i] = this.memlook[1][i] = this.osOffset - 0xc000;

        for (i = 0xfc; i < 0xff; ++i) this.memstat[0][i] = this.memstat[1][i] = 0;

        this.cycles = 0;
        this.ram4k = this.ram8k = this.ram12k = this.ram20k = 0;
        this.pc = this.readmem(0xfffc) | (this.readmem(0xfffd)<<8);
        this.p = new flags();
        this.p.i = 1;
        this.nmi = this.oldnmi = this.nmilock = 0;
        this.output = 0;
        this.tubecycle = this.tubecycles = 0;
        this.halted = false;
        this.instructions = generate6502();
        this.disassemble = disassemble6502;
        // TODO: cpu type support.
        console.log("Starting PC = " + hexword(this.pc));
    };

    this.setzn = function(v) {
        this.p.z = (v != 0);
        this.p.n = (v & 0x80) == 0x80;
    }

    this.push = function(v) {
        this.writemem(0x100 + this.s, v);
        this.s = (this.s - 1) & 0xff;
    }

    this.pull = function() {
        this.s = (this.s + 1) & 0xff;
        return this.readmem(0x100 + this.s);
    }

    this.polltime = function(cycles) {
        this.cycles -= cycles;
        // TODO: lots more...
    }

    this.branch = function(taken) {
        var offset = signExtend(this.getb());
        if (!taken) {
            this.polltime(2);
            this.checkInt();
            return;
        }
        var cycles = 3;
        var newPc = (this.pc + offset) & 0xffff;
        if ((this.pc & 0xff00) ^ (newPc & 0xff00)) cycles++;
        this.pc = newPc;
        this.polltime(cycles - 1);
        this.checkInt();
        this.polltime(1);
    }

    this.adc = function(addend, isC) {
        if (!this.p.d) {
            var tempw = (this.a + addend + (this.p.c ? 1 : 0)) & 0xffff;
            this.p.v = !((this.a ^ addend) & 0x80) && !!((this.a ^ tempw) & 0x80);
            this.a = tempw & 0xff;
            this.p.c = !!(tempw & 0x100);
            this.setzn(this.a);
        } else {
            var ah = 0;
            var tempb = (this.a + addend + (this.p.c ? 1 : 0)) & 0xff;
            if (!isC && !tempb) this.p.z = true;
            var al = (this.a & 0xf) + (addend & 0xf) + (this.p.c ? 1 : 0);
            if (al > 9) {
                al -= 10;
                al &= 0xf;
                ah = 1;
            }
            ah += (this.a >> 4) + (addend >> 4);
            if (!isC && (ah & 8)) this.p.n = true;
            this.p.v = !((this.a ^ addend) & 0x80) && !!((this.a ^ (ah << 4)) & 0x80);
            this.p.c = false;
            if (ah > 9) {
                this.p.c = true;
                ah -= 10;
                ah &= 0xf;
            }
            this.a = ((al & 0xf) | (ah << 4)) & 0xff;
            if (isC) {
                this.setzn(this.a);
                this.polltime(1);
            }
        }
    }

    this.sbc = function(subend, isC) {
        if (!this.p.d) {
            subend += this.p.c ? 0 : 1;
            var tempv = this.a - subend;
            var tempw = tempv & 0xffff;
            this.p.v = !!((this.a ^ subend) & (this.a ^ tempv) & 0x80);
            this.p.c = tempv >= 0;
            this.a = tempw & 0xff;
            this.setzn(this.a);
        } else {
            throw "Oh noes";
        }
    }

    this.execute = function() {
        if (this.halted) return;
        this.cycles += 40000;
        while (!this.halted && this.cycles > 0) {
            this.pc3 = this.oldoldpc;
            this.oldoldpc = this.oldpc;
            this.oldpc = this.pc;
            this.vis20k = this.ramBank[this.pc>>12];
            var opcode = this.readmem(this.pc);
            if (this.debugInstruction) this.debugInstruction();
            console.log(hexword(this.pc), this.disassemble(this.pc)[0]);
            var instruction = this.instructions[opcode];
            if (!instruction) {
                console.log("Invalid opcode " + hexbyte(opcode) + " at " + hexword(this.pc));
                console.log(this.disassemble(this.pc)[0]);
                this.dumpregs();
                this.halted = true;
                return;
            }
            this.incpc();
            instruction(this);
            // TODO: timetolive
            // TODO: interrupts
            this.interrupt &= 0x7f;
            // TODO: otherstuff
            // TODO: tube
            // TODO: nmis
        }
    }

    this.loadOs("roms/os");
    this.reset();
}

