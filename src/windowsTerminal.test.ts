/**
 * Copyright (c) 2017, Daniel Imms (MIT License).
 * Copyright (c) 2018, Microsoft Corporation (MIT License).
 */

import * as cp from 'child_process';
import * as fs from 'fs';
import * as assert from 'assert';
import { WindowsTerminal } from './windowsTerminal';
import * as path from 'path';
import * as psList from 'ps-list';

let getProcessList: any;
if (process.platform === 'win32') {
  getProcessList = require('windows-process-tree');
}

interface IProcessState {
  // Whether the PID must exist or must not exist
  [pid: number]: boolean;
}

function pollForProcessState(desiredState: IProcessState, intervalMs: number = 100, timeoutMs: number = 2000): Promise<void> {
  return new Promise<void>(resolve => {
    let tries = 0;
    const interval = setInterval(() => {
      psList({ all: true }).then(ps => {
        let success = true;
        const pids = Object.keys(desiredState).map(k => parseInt(k, 10));
        pids.forEach(pid => {
          if (desiredState[pid]) {
            if (!ps.some(p => p.pid === pid)) {
              success = false;
            }
          } else {
            if (ps.some(p => p.pid === pid)) {
              success = false;
            }
          }
        });
        if (success) {
          clearInterval(interval);
          resolve();
          return;
        }
        tries++;
        if (tries * intervalMs >= timeoutMs) {
          clearInterval(interval);
          const processListing = pids.map(k => `${k}: ${desiredState[k]}`).join('\n');
          assert.fail(`Bad process state, expected:\n${processListing}`);
          resolve();
        }
      });
    }, intervalMs);
  });
}

if (process.platform === 'win32') {
  describe('WindowsTerminal', () => {
    describe('kill', () => {
      it('should not crash parent process', (done) => {
        const term = new WindowsTerminal('cmd.exe', [], {});
        term.kill();
        // Add done call to deferred function queue to ensure the kill call has completed
        (<any>term)._defer(done);
      });
      it('should kill the process tree', function (done: Mocha.Done): void {
        this.timeout(5000);

        const term = new WindowsTerminal('cmd.exe', [], {});
        // Start a sub-process
        term.write('powershell.exe\r');
        term.write('notepad.exe\r');
        term.write('node.exe\r');
        setTimeout(() => {
          getProcessList(term.pid, (list: {name: string, pid: number}[]) => {
            assert.equal(list.length, 4);
            assert.equal(list[0].name, 'cmd.exe');
            assert.equal(list[1].name, 'powershell.exe');
            assert.equal(list[2].name, 'notepad.exe');
            assert.equal(list[3].name, 'node.exe');
            term.kill();
            const desiredState: IProcessState = {};
            desiredState[list[0].pid] = false;
            desiredState[list[1].pid] = false;
            desiredState[list[2].pid] = true;
            desiredState[list[3].pid] = false;
            pollForProcessState(desiredState).then(() => {
              // Kill notepad before done
              process.kill(list[2].pid);
              done();
            });
          });
        }, 1000);
      });
    });

    describe('resize', () => {
      it('should throw a non-native exception when resizing an invalid value', () => {
        const term = new WindowsTerminal('cmd.exe', [], {});
        assert.throws(() => term.resize(-1, -1));
        assert.throws(() => term.resize(0, 0));
        assert.doesNotThrow(() => term.resize(1, 1));
      });
      it('should throw an non-native exception when resizing a killed terminal', (done) => {
        const term = new WindowsTerminal('cmd.exe', [], {});
        (<any>term)._defer(() => {
          term.on('exit', () => {
            assert.throws(() => term.resize(1, 1));
            done();
          });
          term.destroy();
        });
      });
    });

    describe('Args as CommandLine', () => {
      it('should not fail running a file containing a space in the path', (done) => {
        const spaceFolder = path.resolve(__dirname, '..', 'fixtures', 'space folder');
        if (!fs.existsSync(spaceFolder)) {
          fs.mkdirSync(spaceFolder);
        }

        const cmdCopiedPath = path.resolve(spaceFolder, 'cmd.exe');
        const data = fs.readFileSync(`${process.env.windir}\\System32\\cmd.exe`);
        fs.writeFileSync(cmdCopiedPath, data);

        if (!fs.existsSync(cmdCopiedPath)) {
          // Skip test if git bash isn't installed
          return;
        }
        const term = new WindowsTerminal(cmdCopiedPath, '/c echo "hello world"', {});
        let result = '';
        term.on('data', (data) => {
          result += data;
        });
        term.on('exit', () => {
          assert.ok(result.indexOf('hello world') >= 1);
          done();
        });
      });
    });

    describe('env', () => {
      it('should set environment variables of the shell', (done) => {
        const term = new WindowsTerminal('cmd.exe', '/C echo %FOO%', { env: { FOO: 'BAR' }});
        let result = '';
        term.on('data', (data) => {
          result += data;
        });
        term.on('exit', () => {
          assert.ok(result.indexOf('BAR') >= 0);
          done();
        });
      });
    });

    describe('On close', () => {
      it('should return process zero exit codes', (done) => {
        const term = new WindowsTerminal('cmd.exe', '/C exit');
        term.on('exit', (code) => {
          assert.equal(code, 0);
          done();
        });
      });

      it('should return process non-zero exit codes', (done) => {
        const term = new WindowsTerminal('cmd.exe', '/C exit 2');
        term.on('exit', (code) => {
          assert.equal(code, 2);
          done();
        });
      });
    });
  });
}
