import 'dotenv/config';
import mongoose from 'mongoose';

async function dropAllIndexes() {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error('Missing MONGODB_URI in .env');
        process.exit(1);
    }

    try {
        await mongoose.connect(uri);
        console.log('Connected to MongoDB');

        const collection = mongoose.connection.collection('credentials');
        const indexes = await collection.indexes();
        console.log('Current indexes:', JSON.stringify(indexes, null, 2));

        for (const index of indexes) {
            if (index.name !== '_id_') {
                console.log(`Dropping index: ${index.name}`);
                await collection.dropIndex(index.name);
            }
        }

        console.log('Finished dropping indexes.');
        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

dropAllIndexes();
