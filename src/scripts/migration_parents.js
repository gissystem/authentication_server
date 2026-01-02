import { MongoClient } from 'mongodb';
// Database configuration
const SOURCE_DB_URI = 'mongodb://=atlassl=true';
const TARGET_DB_URI = 'mongodb:// name'
const TARGET_DB_NAME = 'authentication'; // Replace with your target database name
const SOURCE_COLLECTION = 'child_models';
const TARGET_COLLECTION = 'credentials';

// Field mapping configuration
// Map source fields to target fields
const fieldMapping = {
  firstName: 'firstNameFather',
  lastName: 'lastNameFather',
  password: 'password',
  email: 'emailAddressOfAParent',
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

  mappedDoc.userId = sourceDoc.parentId ?? sourceDoc.childID ?? null;
  mappedDoc.deviceId = '';
  mappedDoc.appId = ['ParentApp'];
  mappedDoc.title = 'Parent';
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
    const totalDocs = await sourceCollection.countDocuments();
    console.log(`Found ${totalDocs} documents in source collection`);
    
    if (totalDocs === 0) {
      console.log('No documents to migrate');
      return;
    }
    
    // Fetch all documents from source
    console.log('Fetching documents from source...');
    const sourceDocs = await sourceCollection.find({}).toArray();
    
    const notLeft = sourceDocs.filter(doc => doc.isLeave !== true);
    const withValidUserId = notLeft.filter(doc => (doc.parentId ?? doc.childID) != null);
    console.log(`Source docs after isLeave filter: ${notLeft.length} / ${sourceDocs.length}`);
    console.log(`Source docs with valid userId (parentId/childID): ${withValidUserId.length} / ${notLeft.length}`);
    
    // Map documents
    console.log('Mapping documents...');
    const mappedDocs = notLeft.flatMap(doc => createDocsForApps(doc));
    
    const validDocs = mappedDocs.filter(doc => doc.userId != null);
    console.log(`Mapped docs with non-null userId: ${validDocs.length} / ${mappedDocs.length}`);
    
    // Upsert into target collection (idempotent: safe to re-run)
    console.log('Upserting documents into target collection...');
    const operations = validDocs.map(doc => ({
      updateOne: {
        filter: { userId: doc.userId },
        update: {
          $set: {
            firstName: doc.firstName,
            lastName: doc.lastName,
            password: doc.password,
            email: doc.email,
            title: doc.title,
            deviceId: doc.deviceId,
            url: doc.url,
            schoolId: doc.schoolId,
            updatedAt: new Date()
          },
          $addToSet: {
            appId: { $each: doc.appId }
          },
          $setOnInsert: {
            userId: doc.userId,
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
    
    const sourceCount = await sourceCollection.countDocuments();
    const sourceDocs = await sourceCollection.find({}).toArray();
    const notLeft = sourceDocs.filter(doc => doc.isLeave !== true);
    
    // Get unique userIds (parents)
    const validUserIds = notLeft
      .map(doc => doc.parentId ?? doc.childID)
      .filter(id => id != null);
    const uniqueUserIds = [...new Set(validUserIds)];
    
    // Check exactly how many of THESE unique parents exist in target
    const targetMatchedCount = await targetCollection.countDocuments({ 
      userId: { $in: uniqueUserIds },
      appId: 'ParentApp'
    });
    
    console.log(`Source children with valid IDs: ${validUserIds.length}`);
    console.log(`Unique parents (deduplicated userIds): ${uniqueUserIds.length}`);
    console.log(`Target credentials found for these parents: ${targetMatchedCount}`);

    if (targetMatchedCount === uniqueUserIds.length) {
      console.log('✓ Migration successful! All unique parents are present.');
    } else {
      console.log(`⚠ Missing parents! Expected ${uniqueUserIds.length}, found ${targetMatchedCount}`);
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