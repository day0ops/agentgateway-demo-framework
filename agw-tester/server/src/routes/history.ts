import { Router, type Request, type Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

export const historyRouter = Router();

interface HistoryEntry {
  id: string;
  timestamp: string;
  type: 'llm' | 'mcp';
  endpoint: string;
  method: string;
  request: unknown;
  response: unknown;
  durationMs: number;
  status: number;
}

// In-memory storage (for server-side persistence if needed)
const history: HistoryEntry[] = [];
const MAX_HISTORY = 100;

// Get all history entries
historyRouter.get('/', (_req: Request, res: Response) => {
  res.json(history);
});

// Add a history entry
historyRouter.post('/', (req: Request, res: Response) => {
  const entry: HistoryEntry = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    ...req.body,
  };

  history.unshift(entry);

  // Keep only last MAX_HISTORY entries
  if (history.length > MAX_HISTORY) {
    history.splice(MAX_HISTORY);
  }

  res.status(201).json(entry);
});

// Delete a single history entry
historyRouter.delete('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const index = history.findIndex(h => h.id === id);

  if (index === -1) {
    res.status(404).json({ error: { message: 'History entry not found' } });
    return;
  }

  history.splice(index, 1);
  res.status(204).send();
});

// Clear all history
historyRouter.delete('/', (_req: Request, res: Response) => {
  history.length = 0;
  res.status(204).send();
});
