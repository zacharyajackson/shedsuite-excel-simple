require('isomorphic-fetch');
const { ConfidentialClientApplication } = require('@azure/msal-node');
const { Client } = require('@microsoft/microsoft-graph-client');
require('dotenv').config();

// Debug: Check if env variables are loaded
console.log('Environment variables loaded:', {
  clientId: process.env.AZURE_CLIENT_ID ? 'Set' : 'Not set',
  tenantId: process.env.AZURE_TENANT_ID ? 'Set' : 'Not set',
  clientSecret: process.env.AZURE_CLIENT_SECRET ? 'Set' : 'Not set'
});

// Parse the SharePoint URL to get the components
const sharepointUrl = 'https://heartlandcapital.sharepoint.com/sites/Stor-Mor/_layouts/15/Doc.aspx?sourcedoc=%7BCFD9CBC1-9DA4-4289-92BD-3F8CC0A0B7EF%7D&file=(Master)%20Shed%20Suite%20Public%20API%20-%20Sales%20Data.xlsx';
const urlParts = new URL(sharepointUrl);
const hostname = urlParts.hostname;
const sitePath = '/sites/Stor-Mor';

// Extract the file ID from the URL
const fileId = 'CFD9CBC1-9DA4-4289-92BD-3F8CC0A0B7EF';

// MSAL config for confidential client application
const msalConfig = {
  auth: {
    clientId: process.env.AZURE_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`,
    clientSecret: process.env.AZURE_CLIENT_SECRET
  }
};

async function getAuthenticatedClient() {
  const cca = new ConfidentialClientApplication(msalConfig);

  // Define the scopes we need - including write permissions
  const scopes = [
    'https://graph.microsoft.com/.default' // This will use all configured permissions including:
    // Sites.ReadWrite.All
    // Files.ReadWrite.All
    // Sites.Manage.All
  ];

  try {
    // Get token using client credentials flow
    const result = await cca.acquireTokenByClientCredential({
      scopes
    });

    if (!result || !result.accessToken) {
      throw new Error('Failed to acquire access token');
    }

    console.log('Successfully authenticated with read/write permissions!');
    return createGraphClient(result.accessToken);
  } catch (error) {
    console.error('Error getting authenticated client:', {
      message: error.message,
      errorCode: error.errorCode,
      subError: error.subError,
      correlationId: error.correlationId,
      claims: error.claims,
      stack: error.stack
    });
    throw error;
  }
}

function createGraphClient(accessToken) {
  const authProvider = {
    getAccessToken: async () => accessToken
  };
  return Client.initWithMiddleware({ authProvider });
}

async function testWorkbookAccess() {
  try {
    console.log('Getting authenticated client...');
    const client = await getAuthenticatedClient();

    // Get the site using the hostname and site path
    console.log('\nAttempting to access:');
    console.log('Hostname:', hostname);
    console.log('Site Path:', sitePath);
    console.log('File ID:', fileId);

    const site = await client.api(`/sites/${hostname}:${sitePath}`)
      .get();
    console.log('\nSite Details:');
    console.log('- Display Name:', site.displayName);
    console.log('- Site ID:', site.id);
    console.log('- Web URL:', site.webUrl);

    // Try to access the workbook directly using the site's default drive
    console.log('\nAttempting to access workbook directly...');
    const workbook = await client.api(`/sites/${site.id}/drive/items/${fileId}/workbook`)
      .get();
    console.log('Successfully accessed workbook!');

    // Get worksheets
    const worksheets = await client.api(`/sites/${site.id}/drive/items/${fileId}/workbook/worksheets`)
      .get();
    console.log('\nWorksheets in the workbook:', worksheets.value.map(ws => ws.name));
  } catch (error) {
    console.error('\nError Details:', {
      message: error.message,
      statusCode: error.statusCode,
      code: error.code,
      body: error.body ? JSON.parse(error.body) : undefined
    });
  }
}

// Add a test function to verify write permissions
async function testWorkbookWriteAccess() {
  try {
    console.log('Getting authenticated client...');
    const client = await getAuthenticatedClient();

    // Get the site
    console.log('\nGetting site...');
    const site = await client.api(`/sites/${hostname}:${sitePath}`).get();

    // Try to access the workbook directly
    console.log('\nAccessing workbook...');
    const workbook = await client.api(`/sites/${site.id}/drive/items/${fileId}/workbook`)
      .get();
    console.log('Successfully accessed workbook for writing!');

    // Try to create a test worksheet
    console.log('\nTesting write permissions...');
    const worksheetName = 'TestSheet_' + new Date().getTime();
    await client.api(`/sites/${site.id}/drive/items/${fileId}/workbook/worksheets/add`)
      .post({
        name: worksheetName
      });

    console.log(`Successfully created test worksheet: ${worksheetName}`);

    // Clean up by deleting the test worksheet
    console.log('\nCleaning up test worksheet...');
    await client.api(`/sites/${site.id}/drive/items/${fileId}/workbook/worksheets/${worksheetName}`)
      .delete();

    console.log('Successfully verified read/write access!');
  } catch (error) {
    console.error('\nError testing write access:', {
      message: error.message,
      statusCode: error.statusCode,
      code: error.code,
      body: error.body ? JSON.parse(error.body) : undefined
    });
  }
}

// Export both test functions
module.exports = {
  testWorkbookAccess,
  testWorkbookWriteAccess
};

// Run both tests
Promise.all([
  testWorkbookAccess(),
  testWorkbookWriteAccess()
]).then(() => {
  console.log('\nAll tests complete');
}).catch(err => {
  console.error('\nTests failed:', err);
});
