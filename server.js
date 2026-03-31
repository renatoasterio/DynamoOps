const app = require('./src/backend/app');

const PORT = process.env.PORT || 3457;

app.listen(PORT, () => {
    console.log(`\n  🚀  DynamoDB GUI running at  http://localhost:${PORT}\n`);
});
