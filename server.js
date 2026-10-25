const app = require('./src/backend/app');
const { HOST, getPort } = require('./src/backend/config/server');

const PORT = getPort();

app.listen(PORT, HOST, () => {
    console.log(`\n  🚀  DynamoOps running at  http://localhost:${PORT}\n`);
});
