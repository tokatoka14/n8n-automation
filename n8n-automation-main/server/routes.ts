import type { Application } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertOrderSchema, updateOrderSchema, type AttachedFile } from "@shared/schema";
import { sendOrderConfirmationEmail, sendOrderNotificationEmail } from "./services/email";
import { sendOrderNotificationToSlack } from "./services/slack";
import multer from "multer";
import path from "path";

const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 4 * 1024 * 1024, // 4MB limit for Vercel
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.csv', '.json', '.pdf', '.png', '.jpg', '.jpeg'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

export async function registerRoutes(app: Application): Promise<Server> {
  // Order management routes
  app.post("/api/orders", upload.array('files', 5), async (req, res) => {
    /**
     * @description
     * **Root Cause & Serverless Model Explanation:**
     * The `FUNCTION_INVOCATION_FAILED` error on Vercel indicates an unhandled exception that crashed the serverless function process.
     * In a serverless environment, the function is expected to return an HTTP response for every invocation.
     * If an error occurs and is not explicitly caught and handled (e.g., by sending a 500 response),
     * the function runtime itself terminates, leading to a platform-level `FUNCTION_INVOCATION_FAILED`.
     *
     * The specific `TypeError: Cannot read properties of undefined (reading 'name')` implies that
     * a property (`name`) was being accessed on an `undefined` object (likely `user.profile`).
     * This typically happens when incoming data (`req.body` or other inputs) does not match
     * the expected structure, causing a nested object to be `undefined` when code tries to access its properties.
     *
     * **The Fix:**
     * This `try...catch` block wraps the entire processing logic for the `/api/orders` route.
     * It ensures that any synchronous or asynchronous errors (including `TypeErrors` from undefined property access)
     * are caught before they can crash the function.
     *
     * Upon catching an error, it logs the `req.body` and the full error stack, which is crucial for debugging in Vercel logs.
     * It then sends a controlled `500 Internal Server Error` response to the client, preventing the `FUNCTION_INVOCATION_FAILED`
     * and ensuring a consistent API response.
     *
     * **Warning Signs & Future Prevention:**
     * - Unhandled exceptions leading to process crashes in serverless functions.
     * - `TypeError: Cannot read properties of undefined` in runtime logs.
     * - Missing `try...catch` or `.catch()` for asynchronous operations in critical paths.
     * - Assumptions about incoming data structure (always validate input rigorously, e.g., with Zod schemas).
     *
     * Always validate incoming request bodies (like `req.body`) against your expected schemas.
     * Use optional chaining (`?.`) when accessing potentially undefined nested properties where appropriate,
     * but prefer robust validation to ensure data integrity.
     */
    try {
      console.log('Request body:', req.body);
      console.log('Request files:', req.files);

      // Parse JSON fields that come as strings from FormData
      const parsedBody = { ...req.body };
      if (parsedBody.integrations && typeof parsedBody.integrations === 'string') {
        try {
          parsedBody.integrations = JSON.parse(parsedBody.integrations);
        } catch (e) {
          console.error('Failed to parse integrations:', e);
          // Consider returning an error response here if parsing is critical
        }
      }
      if (parsedBody.hasCredentials && typeof parsedBody.hasCredentials === 'string') {
        try {
          parsedBody.hasCredentials = JSON.parse(parsedBody.hasCredentials);
        } catch (e) {
          console.error('Failed to parse hasCredentials:', e);
          // Consider returning an error response here if parsing is critical
        }
      }

      const orderData = insertOrderSchema.parse(parsedBody);

      // Handle file uploads
      const files = req.files as Express.Multer.File[];
      const attachedFiles: AttachedFile[] = files?.map(file => ({
        originalName: file.originalname,
        filename: file.filename,
        path: file.path,
        size: file.size,
        mimetype: file.mimetype
      })) || [];

      const order = await storage.createOrder({
        ...orderData,
        attachedFiles,
      });

      // Send notifications
      try {
        await Promise.all([
          sendOrderConfirmationEmail(order.email, order.fullName, order.orderId),
          sendOrderNotificationEmail(['svimonishvilitoka@gmail.com', 'giorginatsvlishvili2010@gmail.com'], order),
          sendOrderNotificationToSlack(order)
        ]);
      } catch (notificationError) {
        console.error('Notification error:', notificationError);
        // Don't fail the order creation if notifications fail
      }

      res.json({ success: true, orderId: order.orderId });
    } catch (error) {
      console.error('Order creation and processing error:', error);
      console.error('Request body that caused the error:', req.body);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'An unexpected error occurred during order processing. Please check logs for details.',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/api/orders", async (req, res) => {
    try {
      const orders = await storage.getAllOrders();
      res.json(orders);
    } catch (error) {
      console.error('Failed to fetch orders:', error);
      res.status(500).json({ error: 'Failed to fetch orders' });
    }
  });

  app.get("/api/orders/:id", async (req, res) => {
    try {
      const order = await storage.getOrder(req.params.id);
      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }
      res.json(order);
    } catch (error) {
      console.error('Failed to fetch order by ID:', error);
      res.status(500).json({ error: 'Failed to fetch order' });
    }
  });

  app.get("/api/orders/by-order-id/:orderId", async (req, res) => {
    try {
      const order = await storage.getOrderByOrderId(req.params.orderId);
      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }
      res.json(order);
    } catch (error) {
      console.error('Failed to fetch order by Order ID:', error);
      res.status(500).json({ error: 'Failed to fetch order' });
    }
  });

  app.patch("/api/orders/:id", async (req, res) => {
    try {
      const updates = updateOrderSchema.parse(req.body);
      const order = await storage.updateOrder(req.params.id, updates);
      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }
      res.json(order);
    } catch (error) {
      console.error('Order update error:', error);
      res.status(400).json({
        error: "Invalid input data",
        message: error instanceof Error ? error.message : "An unexpected error occurred.",
      });
    }
  });

  app.delete("/api/orders/:id", async (req, res) => {
    try {
      const success = await storage.deleteOrder(req.params.id);
      if (!success) {
        return res.status(404).json({ error: 'Order not found' });
      }
      res.json({ success: true });
    } catch (error) {
      console.error('Order delete error:', error);
      res.status(500).json({ error: 'Failed to delete order' });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
