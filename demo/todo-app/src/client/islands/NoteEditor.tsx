import { island } from "@mandujs/core/client";
import { useState, useCallback } from "react";
import type { Note, Todo } from "../../shared/types";

interface NoteEditorData {
  initialNotes: Note[];
  todos: Todo[];
}

export default island<NoteEditorData>({
  setup: (serverData) => {
    const [notes, setNotes] = useState<Note[]>(serverData.initialNotes);
    const [todos] = useState<Todo[]>(serverData.todos);
    const [newTitle, setNewTitle] = useState("");
    const [newContent, setNewContent] = useState("");
    const [newTodoId, setNewTodoId] = useState("");
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editTitle, setEditTitle] = useState("");
    const [editContent, setEditContent] = useState("");

    const todoMap = new Map(todos.map((t) => [t.id, t]));

    const addNote = useCallback(async () => {
      if (!newTitle.trim() || !newContent.trim()) return;
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle.trim(),
          content: newContent.trim(),
          todoId: newTodoId || undefined,
        }),
      });
      const { note } = await res.json();
      setNotes((prev) => [note, ...prev]);
      setNewTitle("");
      setNewContent("");
      setNewTodoId("");
    }, [newTitle, newContent, newTodoId]);

    const togglePin = useCallback(async (id: string) => {
      const target = notes.find((n) => n.id === id);
      if (!target) return;
      const res = await fetch(`/api/notes/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: !target.pinned }),
      });
      const { note } = await res.json();
      setNotes((prev) => prev.map((n) => (n.id === id ? note : n))
        .sort((a, b) => {
          if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
          return b.createdAt.localeCompare(a.createdAt);
        }));
    }, [notes]);

    const startEdit = useCallback((note: Note) => {
      setEditingId(note.id);
      setEditTitle(note.title);
      setEditContent(note.content);
    }, []);

    const saveEdit = useCallback(async () => {
      if (!editingId || !editTitle.trim()) return;
      const res = await fetch(`/api/notes/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editTitle.trim(), content: editContent.trim() }),
      });
      const { note } = await res.json();
      setNotes((prev) => prev.map((n) => (n.id === editingId ? note : n)));
      setEditingId(null);
    }, [editingId, editTitle, editContent]);

    const cancelEdit = useCallback(() => setEditingId(null), []);

    const deleteNote = useCallback(async (id: string) => {
      await fetch(`/api/notes/${id}`, { method: "DELETE" });
      setNotes((prev) => prev.filter((n) => n.id !== id));
    }, []);

    return {
      notes, todos, todoMap,
      newTitle, newContent, newTodoId, editingId, editTitle, editContent,
      setNewTitle, setNewContent, setNewTodoId, setEditTitle, setEditContent,
      addNote, togglePin, startEdit, saveEdit, cancelEdit, deleteNote,
    };
  },

  render: (ctx) => {
    const {
      notes, todos, todoMap,
      newTitle, newContent, newTodoId, editingId, editTitle, editContent,
      setNewTitle, setNewContent, setNewTodoId, setEditTitle, setEditContent,
      addNote, togglePin, startEdit, saveEdit, cancelEdit, deleteNote,
    } = ctx;

    return (
      <div>
        <h1
          className="text-4xl mb-1"
          style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic' }}
        >
          Notes
        </h1>
        <p className="text-sm mb-8" style={{ color: 'var(--color-ink-muted)' }}>
          {notes.length} notes, {notes.filter((note) => note.pinned).length} pinned
        </p>
        {/* Add form */}
        <form onSubmit={(e) => { e.preventDefault(); addNote(); }} className="card p-5 mb-6">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Note title"
            className="input-warm mb-3"
          />
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="Write your note..."
            rows={3}
            className="input-warm mb-3"
            style={{ resize: 'none' }}
          />
          <div className="flex gap-3 items-center">
            <select
              value={newTodoId}
              onChange={(e) => setNewTodoId(e.target.value)}
              className="select-warm"
            >
              <option value="">Link to todo (optional)</option>
              {todos.map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
            <button type="submit" className="btn-primary ml-auto">Add Note</button>
          </div>
        </form>

        {/* Notes list */}
        {notes.length === 0 ? (
          <div className="card p-10 text-center">
            <div className="text-3xl mb-3">📝</div>
            <p className="text-sm" style={{ color: 'var(--color-ink-muted)' }}>No notes yet. Create one above!</p>
          </div>
        ) : (
          <div className="space-y-3">
            {notes.map((note) => {
              const linkedTodo = note.todoId ? todoMap.get(note.todoId) : null;
              return (
                <div
                  key={note.id}
                  className="card p-5 group"
                  style={note.pinned ? { borderLeftWidth: '4px', borderLeftColor: 'var(--color-amber)' } : {}}
                >
                  {editingId === note.id ? (
                    <div>
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="input-warm mb-3"
                        autoFocus
                      />
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        rows={3}
                        className="input-warm mb-3"
                        style={{ resize: 'none' }}
                      />
                      <div className="flex gap-2">
                        <button onClick={saveEdit} className="btn-primary" style={{ padding: '6px 16px', fontSize: '13px' }}>Save</button>
                        <button onClick={cancelEdit} className="btn-secondary" style={{ padding: '6px 16px', fontSize: '13px' }}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start gap-3">
                        <button
                          onClick={() => togglePin(note.id)}
                          className="text-lg shrink-0 mt-0.5 transition-transform hover:scale-110"
                          style={{ color: note.pinned ? 'var(--color-amber)' : 'var(--color-ink-faint)' }}
                          title={note.pinned ? "Unpin" : "Pin"}
                        >
                          {note.pinned ? "\u2605" : "\u2606"}
                        </button>
                        <div className="flex-1 min-w-0">
                          <h3
                            className="text-sm font-semibold mb-1"
                            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}
                          >
                            {note.title}
                          </h3>
                          <p className="text-xs leading-relaxed" style={{ color: 'var(--color-ink-light)', whiteSpace: 'pre-wrap' }}>
                            {note.content}
                          </p>
                          {linkedTodo && (
                            <div className="mt-2">
                              <span
                                className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md"
                                style={{ background: 'var(--color-teal-light)', color: 'var(--color-teal)' }}
                              >
                                🔗 {linkedTodo.title}
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                          <button
                            onClick={() => startEdit(note)}
                            className="text-xs font-medium px-3 py-1 rounded-lg"
                            style={{ color: 'var(--color-teal)', background: 'var(--color-teal-light)' }}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => deleteNote(note.id)}
                            className="text-xs font-medium px-3 py-1 rounded-lg"
                            style={{ color: 'var(--color-terracotta)', background: 'var(--color-terracotta-light)' }}
                          >
                            {"\u00d7"}
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  },
});
