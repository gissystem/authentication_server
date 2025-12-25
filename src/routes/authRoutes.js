import { Router } from 'express';
import { loginWithCredential } from '../controllers/authController.js';

const router = Router();

router.post('/login', loginWithCredential);

export default router;
