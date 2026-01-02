import { MongoClient } from 'mongodb';
// Database configuration
const SOURCE_DB_URI = 'mongodb://=atlassl=true';
const TARGET_DB_URI = 'mongodb:// name';
const TARGET_DB_NAME = 'authentication'; // Replace with your target database name
const SOURCE_COLLECTION = 'employee_models';
const TARGET_COLLECTION = 'credentials';

// Field mapping configuration
// Map source fields to target fields
const fieldMapping = {
  firstName: 'firstName',
  lastName: 'lastName',
  password: 'password',
  email: 'email',
  title: 'title',
  appId: 'appId'
};

/**
 * Maps data from source schema to target schema
 * @param {Object} sourceDoc - Document from source collection
 * @returns {Object} - Mapped document for target collection
 */
function mapDocument(sourceDoc) {
  const mappedDoc = {};
  
  for (const [targetField, sourceField] of Object.entries(fieldMapping)) {
    if (sourceDoc.hasOwnProperty(sourceField)) {
      mappedDoc[targetField] = sourceDoc[sourceField];
    } else {
      // Set default values for missing fields
      mappedDoc[targetField] = null;
    }
  }

  mappedDoc.userId = sourceDoc.employeeID ?? null;
  mappedDoc.deviceId = ' ';
  mappedDoc.appId = ['MENTOR_APP', 'InstituteApp'];
  mappedDoc.url = 'https://unsere-kinder-pesh-town.herokuapp.com';
  mappedDoc.schoolId = 'unsere_kinder';
  
  return mappedDoc;
}

function createDocsForApps(sourceDoc) {
  return [mapDocument(sourceDoc)];
}

/**
 * Main migration function
 */
async function migrateData() {
  let sourceClient;
  let targetClient;
  
  try {
    console.log('Connecting to source database...');
    sourceClient = new MongoClient(SOURCE_DB_URI);
    await sourceClient.connect();
    const sourceDb = sourceClient.db(SOURCE_DB_NAME);
    const sourceCollection = sourceDb.collection(SOURCE_COLLECTION);
    
    console.log('Connecting to target database...');
    targetClient = new MongoClient(TARGET_DB_URI);
    await targetClient.connect();
    const targetDb = targetClient.db(TARGET_DB_NAME);
    const targetCollection = targetDb.collection(TARGET_COLLECTION);
    
    // Get total count of documents
    const totalDocs = await sourceCollection.countDocuments({ title: { $ne: 'Left' } });
    console.log(`Found ${totalDocs} documents in source collection`);
    
    if (totalDocs === 0) {
      console.log('No documents to migrate');
      return;
    }
    
    // Fetch all documents from source
    console.log('Fetching documents from source...');
    const sourceDocs = await sourceCollection.find({ title: { $ne: 'Left' } }).toArray();
    
    // Map documents
    console.log('Mapping documents...');
    const mappedDocs = sourceDocs.flatMap(doc => createDocsForApps(doc));
    
    // Upsert into target collection (idempotent: safe to re-run)
    console.log('Upserting documents into target collection...');
    const operations = mappedDocs.map(doc => ({
      updateOne: {
        filter: { userId: doc.userId },
        update: {
          $set: {
            ...doc,
            updatedAt: new Date()
          },
          $setOnInsert: {
            createdAt: new Date()
          }
        },
        upsert: true
      }
    }));

    const result = await targetCollection.bulkWrite(operations, { ordered: false });

    const upserted = result.upsertedCount ?? 0;
    const modified = result.modifiedCount ?? 0;
    const matched = result.matchedCount ?? 0;
    console.log(`Upsert summary: upserted=${upserted}, modified=${modified}, matched=${matched}`);

    console.log('Cleaning up duplicate credentials (per userId)...');
    const duplicates = await targetCollection
      .aggregate([
        {
          $group: {
            _id: '$userId',
            docs: { $push: { _id: '$_id', appId: '$appId' } },
            count: { $sum: 1 }
          }
        },
        { $match: { count: { $gt: 1 } } }
      ])
      .toArray();

    let deletedDuplicates = 0;
    for (const group of duplicates) {
      const docs = group.docs ?? [];
      const preferred = docs.find(d => Array.isArray(d.appId));
      const keepId = preferred?._id ?? docs[0]?._id;
      const toDelete = docs
        .filter(d => String(d._id) !== String(keepId))
        .map(d => d._id);

      if (toDelete.length > 0) {
        const delRes = await targetCollection.deleteMany({ _id: { $in: toDelete } });
        deletedDuplicates += delRes.deletedCount ?? 0;
      }
    }

    console.log(`Duplicate cleanup deleted ${deletedDuplicates} documents`);
    console.log('Migration completed successfully!');
    
  } catch (error) {
    console.error('Error during migration:', error.message);
    
    // Handle duplicate key errors
    if (error.code === 11000) {
      console.error('Duplicate key error. Some documents may already exist in target collection.');
      if (error.result && error.result.insertedCount) {
        console.log(`Successfully inserted ${error.result.insertedCount} documents before error`);
      }
    }
    
    throw error;
    
  } finally {
    // Close connections
    if (sourceClient) {
      console.log('Closing source database connection...');
      await sourceClient.close();
    }
    if (targetClient) {
      console.log('Closing target database connection...');
      await targetClient.close();
    }
  }
}

/**
 * Validate migration - optional function to verify data
 */
async function validateMigration() {
  let sourceClient;
  let targetClient;
  
  try {
    console.log('\n=== Validating Migration ===');
    
    sourceClient = new MongoClient(SOURCE_DB_URI);
    await sourceClient.connect();
    const sourceDb = sourceClient.db(SOURCE_DB_NAME);
    const sourceCollection = sourceDb.collection(SOURCE_COLLECTION);
    
    targetClient = new MongoClient(TARGET_DB_URI);
    await targetClient.connect();
    const targetDb = targetClient.db(TARGET_DB_NAME);
    const targetCollection = targetDb.collection(TARGET_COLLECTION);
    
    const sourceCount = await sourceCollection.countDocuments({ title: { $ne: 'Left' } });
    const targetCount = await targetCollection.countDocuments({ appId: 'MENTOR_APP' });
    
    console.log(`Source collection count (excluding 'Left'): ${sourceCount}`);
    console.log(`Target collection count (Employees): ${targetCount}`);

    const expectedTargetCount = sourceCount;
    if (targetCount === expectedTargetCount) {
      console.log('✓ Document counts match!');
    } else {
      console.log(`⚠ Document counts do not match! Expected ${expectedTargetCount}, got ${targetCount}`);
    }
    
  } catch (error) {
    console.error('Error during validation:', error.message);
  } finally {
    if (sourceClient) await sourceClient.close();
    if (targetClient) await targetClient.close();
  }
}

// Run the migration
(async () => {
  try {
    await migrateData();
    await validateMigration();
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
})();