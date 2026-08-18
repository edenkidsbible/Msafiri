import { Router } from "express";
import { db, opsImportBatchesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router = Router();

function parseBatch(b: typeof opsImportBatchesTable.$inferSelect) {
  return {
    id: b.id,
    status: b.status,
    filename: b.filename,
    createdAt: b.createdAt.toISOString(),
    committedAt: b.committedAt?.toISOString() ?? null,
    sheetCount: b.sheetCount,
    rowsCreated: b.rowsCreated,
    rowsUpdated: b.rowsUpdated,
    rowsSkipped: b.rowsSkipped,
    rowsErrored: b.rowsErrored,
    warnings: b.warningsJson ? JSON.parse(b.warningsJson) : [],
    errors: b.errorsJson ? JSON.parse(b.errorsJson) : [],
    sheets: b.sheetsJson ? JSON.parse(b.sheetsJson) : [],
  };
}

router.post("/import/upload", async (req, res) => {
  try {
    const { filename } = req.body;
    if (!filename) return res.status(400).json({ error: "filename is required" });
    const [batch] = await db.insert(opsImportBatchesTable).values({
      filename,
      status: "dry_run",
      sheetCount: 0,
      rowsCreated: 0, rowsUpdated: 0, rowsSkipped: 0, rowsErrored: 0,
      warningsJson: "[]",
      errorsJson: "[]",
      sheetsJson: "[]",
      createdBy: (req as any).adminUser?.id,
    }).returning();
    res.json(parseBatch(batch));
  } catch (err) {
    req.log.error({ err }, "Failed to create import batch");
    res.status(500).json({ error: "Failed to create import batch" });
  }
});

router.get("/import/batches", async (req, res) => {
  try {
    const batches = await db.select().from(opsImportBatchesTable).orderBy(desc(opsImportBatchesTable.createdAt));
    res.json(batches.map(parseBatch));
  } catch (err) {
    req.log.error({ err }, "Failed to list import batches");
    res.status(500).json({ error: "Failed to list import batches" });
  }
});

router.post("/import/batches/:id/commit", async (req, res) => {
  try {
    const [batch] = await db.update(opsImportBatchesTable)
      .set({ status: "committed", committedAt: new Date() })
      .where(eq(opsImportBatchesTable.id, parseInt(req.params.id)))
      .returning();
    if (!batch) return res.status(404).json({ error: "Batch not found" });
    res.json(parseBatch(batch));
  } catch (err) {
    req.log.error({ err }, "Failed to commit import batch");
    res.status(500).json({ error: "Failed to commit import batch" });
  }
});

router.post("/import/batches/:id/rollback", async (req, res) => {
  try {
    const [batch] = await db.update(opsImportBatchesTable)
      .set({ status: "rolled_back" })
      .where(eq(opsImportBatchesTable.id, parseInt(req.params.id)))
      .returning();
    if (!batch) return res.status(404).json({ error: "Batch not found" });
    res.json(parseBatch(batch));
  } catch (err) {
    req.log.error({ err }, "Failed to rollback import batch");
    res.status(500).json({ error: "Failed to rollback import batch" });
  }
});

export default router;
