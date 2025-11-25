import dotenv from 'dotenv';
import { sendOrderConfirmationEmail, sendOrderNotificationEmail } from '../services/email';

dotenv.config({ override: true });

(async () => {
  try {
    console.log('Sending test order confirmation email...');
    const ok = await sendOrderConfirmationEmail('business.nexflow@gmail.com', 'Test Customer', 'ORD-TEST-123');
    console.log('sendOrderConfirmationEmail returned:', ok);

    console.log('Sending test order notification to admin(s)...');
    const adminOk = await sendOrderNotificationEmail([process.env.FROM_EMAIL || process.env.GMAIL_USER || 'business.nexflow@gmail.com'], {
      id: 'test-id',
      orderId: 'ORD-TEST-123',
      fullName: 'Test Customer',
      email: 'business.nexflow@gmail.com',
      projectName: 'Test Project',
      automationType: 'custom_workflow',
      integrations: [],
      attachedFiles: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'new'
    });
    console.log('sendOrderNotificationEmail returned:', adminOk);
    process.exit(ok ? 0 : 1);
  } catch (err) {
    console.error('Error sending test order confirmation email:', err);
    process.exit(1);
  }
})();
