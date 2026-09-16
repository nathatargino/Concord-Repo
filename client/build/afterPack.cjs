const { execSync } = require('child_process');

exports.default = async function (context) {
  const evsUser = process.env.EVS_ACCOUNT_NAME || 'concord';
  const evsPass = process.env.EVS_PASSWD || 'Chosen@123';

  if (evsUser && evsPass) {
    console.log('[EVS] Starting Widevine VMP signing for:', context.appOutDir);
    try {
      execSync(`python -m castlabs_evs.account reauth -A "${evsUser}" -P "${evsPass}"`, {
        stdio: 'inherit',
        env: { ...process.env, EVS_ACCOUNT_NAME: evsUser, EVS_PASSWD: evsPass }
      });
      execSync(`python -m castlabs_evs.vmp sign-pkg -A "${evsUser}" -P "${evsPass}" "${context.appOutDir}"`, {
        stdio: 'inherit',
        env: { ...process.env, EVS_ACCOUNT_NAME: evsUser, EVS_PASSWD: evsPass }
      });
      console.log('[EVS] Widevine VMP signing successfully applied!');
    } catch (err) {
      console.error('[EVS] Error during VMP signing:', err);
    }
  } else {
    console.log('[EVS] Skipping VMP signing: EVS_ACCOUNT_NAME and EVS_PASSWD environment variables are not set.');
  }
};
