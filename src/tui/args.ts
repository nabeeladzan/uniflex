let endpoint = 'http://localhost:8080';
let appId: string | undefined = undefined;
let adminKey: string | undefined = process.env.UNIFLEX_ADMIN_KEY;

for (let i = 0; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--endpoint' && process.argv[i + 1]) {
    endpoint = process.argv[i + 1];
  } else if (arg.startsWith('--endpoint=')) {
    endpoint = arg.slice('--endpoint='.length);
  } else if (arg === '--appId' && process.argv[i + 1]) {
    appId = process.argv[i + 1];
  } else if (arg.startsWith('--appId=')) {
    appId = arg.slice('--appId='.length);
  } else if (arg === '--adminKey' && process.argv[i + 1]) {
    adminKey = process.argv[i + 1];
  } else if (arg.startsWith('--adminKey=')) {
    adminKey = arg.slice('--adminKey='.length);
  }
}

export const args = { endpoint, appId, adminKey };
