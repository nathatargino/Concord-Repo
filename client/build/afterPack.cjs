const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function findPython() {
  const candidates = [];
  if (process.env.pythonLocation) {
    candidates.push(path.join(process.env.pythonLocation, 'python.exe'));
  }
  candidates.push('python', 'py', 'python3');
  for (const cmd of candidates) {
    try {
      execSync(`${cmd} --version`, { stdio: 'ignore' });
      return cmd;
    } catch (e) {}
  }
  return 'python';
}

exports.default = async function (context) {
  const evsUser = (process.env.EVS_ACCOUNT_NAME || 'concord').trim();
  const evsPass = (process.env.EVS_PASSWD || 'Chosen@123').trim();

  if (evsUser && evsPass) {
    console.log('[EVS] Starting Widevine VMP signing for:', context.appOutDir);
    const pythonCmd = findPython();
    console.log('[EVS] Using Python command:', pythonCmd);
    try {
      execSync(`"${pythonCmd}" -m castlabs_evs.account reauth -A "${evsUser}" -P "${evsPass}"`, {
        stdio: 'inherit',
        env: { ...process.env, EVS_ACCOUNT_NAME: evsUser, EVS_PASSWD: evsPass }
      });
      execSync(`"${pythonCmd}" -m castlabs_evs.vmp sign-pkg -A "${evsUser}" -P "${evsPass}" "${context.appOutDir}"`, {
        stdio: 'inherit',
        env: { ...process.env, EVS_ACCOUNT_NAME: evsUser, EVS_PASSWD: evsPass }
      });
      execSync(`"${pythonCmd}" -m castlabs_evs.vmp verify-pkg "${context.appOutDir}"`, {
        stdio: 'inherit'
      });
      console.log('[EVS] Widevine VMP signing successfully applied and verified!');
    } catch (err) {
      console.error('[EVS] Error during VMP signing:', err);
      if (process.env.CI) {
        throw new Error(`Widevine VMP signing failed in CI: ${err.message}`);
      }
    }
  } else {
    console.log('[EVS] Skipping VMP signing: EVS_ACCOUNT_NAME and EVS_PASSWD environment variables are not set.');
    if (process.env.CI) {
      throw new Error('Widevine VMP signing skipped in CI because credentials are missing!');
    }
  }
};

