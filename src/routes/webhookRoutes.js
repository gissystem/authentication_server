import { Router } from 'express';
import { extractCredentialsFromBody } from '../middleware/auth.js';
import { receiveCredentialWebhook } from '../controllers/webhookController.js';

const router = Router();

router.post('/', extractCredentialsFromBody(), receiveCredentialWebhook);

export default router;
