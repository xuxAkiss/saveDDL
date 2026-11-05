import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLaunchCommand } from '../src/lib/registry.js';

test('development command passes the app path and "%1"', () => {
  const command = buildLaunchCommand({
    execPath: 'C:\\SaveDDL\\electron.exe',
    appPath: 'C:\\SaveDDL\\app',
    packaged: false,
  });
  assert.equal(command, '"C:\\SaveDDL\\electron.exe" "C:\\SaveDDL\\app" --add-file "%1"');
});

test('packaged command calls the executable directly', () => {
  const command = buildLaunchCommand({
    execPath: 'C:\\Program Files\\SaveDDL\\SaveDDL.exe',
    appPath: 'ignored',
    packaged: true,
  });
  assert.equal(command, '"C:\\Program Files\\SaveDDL\\SaveDDL.exe" --add-file "%1"');
});