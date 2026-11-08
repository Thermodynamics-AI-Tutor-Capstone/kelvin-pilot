import { provision, provisionHash, revoke, deleteStudent, trends } from './store.mjs';
import { accountById, addInstructorHash, disableAccount } from './oauth.mjs';
const [command, arg, hash, role, passwordHash] = process.argv.slice(2);
try {
  if (command === 'provision-student') console.log(JSON.stringify(await provision('student', arg)));
  else if (command === 'provision-instructor') console.log(JSON.stringify(await provision('instructor', arg)));
  else if (command === 'provision-student-hash') console.log(JSON.stringify(await provisionHash('student', arg, hash)));
  else if (command === 'provision-instructor-hash') console.log(JSON.stringify(await provisionHash('instructor', arg, hash)));
  else if (command === 'instructor-hash') console.log(JSON.stringify(await addInstructorHash(arg, hash, role, passwordHash)));
  else if (command === 'disable-account') { await disableAccount(arg); console.log('Account disabled'); }
  else if (command === 'revoke') { await revoke(arg); console.log('Revoked'); }
  else if (command === 'delete-student') { await deleteStudent(arg); if (await accountById(arg)) await disableAccount(arg); console.log('Student records deleted and account access disabled'); }
  else if (command === 'trends') console.log(JSON.stringify(await trends(), null, 2));
  else { console.error('Usage: node admin.mjs instructor-hash ID NAME SALT SCRYPT_HASH | disable-account ID | provision-student ID | provision-instructor ID | revoke ID | delete-student ID | trends'); process.exitCode = 2; }
} catch (e) { console.error(e.message); process.exitCode = 1; }
