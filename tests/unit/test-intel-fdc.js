import { describe, it } from "vitest";
import assert from "assert";

import { Scheduler } from "../../src/scheduler.js";
import { IntelFdc } from "../../src/intel-fdc.js";
import { fake6502 } from "../../src/fake6502.js";

class FakeDrive {
    constructor() {
        this.spinning = false;
        this.pulsesCallback = null;
        this.upperSide = false;
        this.track = 0;
    }
    selectSide(side) {
        this.upperSide = side;
    }
    setPulsesCallback(callback) {
        this.pulsesCallback = callback;
    }
    startSpinning() {
        this.spinning = true;
    }
    stopSpinning() {
        this.spinning = false;
    }
    seekOneTrack(dir) {
        this.track = this.track + dir;
    }
    notifySeek() {}
}

/**
 * @param {IntelFdc} fdc
 * @param  {Number} command
 * @param  {...Number} params
 */
function sendCommand(fdc, command, ...params) {
    fdc.write(0, command);
    for (const param of params) fdc.write(1, param);
}

describe("Intel 8271 tests", function () {
    it("should contruct and start out idle", () => {
        const fakeCpu = fake6502();
        const scheduler = new Scheduler();
        const fdc = new IntelFdc(fakeCpu, scheduler);
        assert.equal(fdc.internalStatus, 0);
        assert.equal(scheduler.headroom(), Scheduler.MaxHeadroom);
    });

    it("should go busy as soon as a command is registered", () => {
        const fakeCpu = fake6502();
        const scheduler = new Scheduler();
        const fdc = new IntelFdc(fakeCpu, scheduler);
        fdc.write(0, 0x3a);
        assert.equal(fdc.internalStatus, 0x80); // 0x80 = busy
    });

    const loadHead = 0x08;
    const select1 = 0x40;
    const writeRegCmd = 0x3a;
    const mmioWrite = 0x23;
    const seekCmd = (0x0a << 2) | select1 | 1;

    it("should spin up when poked", () => {
        const fakeCpu = fake6502();
        const scheduler = new Scheduler();
        const fakeDrive = new FakeDrive();
        const fdc = new IntelFdc(fakeCpu, scheduler, [fakeDrive]);
        assert.equal(fdc._driveOut & loadHead, 0);
        assert(!fakeDrive.spinning);
        sendCommand(fdc, writeRegCmd, mmioWrite, loadHead | select1);
        assert.equal(fdc._driveOut & loadHead, loadHead);
        assert(fakeDrive.spinning);
    });
    it("should seek to a track", () => {
        const fakeCpu = fake6502();
        const scheduler = new Scheduler();
        const fakeDrive = new FakeDrive();
        const fdc = new IntelFdc(fakeCpu, scheduler, [fakeDrive]);
        sendCommand(fdc, writeRegCmd, mmioWrite, loadHead | select1);
        // nb will seek two more due to bad track nonsense
        sendCommand(fdc, seekCmd, 2);
        assert.equal(fakeDrive.track, 1);
        // We should have some 3ms step scheduled
        assert.equal(scheduler.headroom(), 6000);
        scheduler.polltime(6000);
        assert.equal(fakeDrive.track, 2);
        // We should reach and stop at track 4.
        scheduler.polltime(6000 * 10);
        assert.equal(fakeDrive.track, 4);
    });
});
