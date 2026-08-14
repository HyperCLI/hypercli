import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { FilesUploadZone } from "@hypercli/shared-ui/files";

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, initial, animate, exit, transition, ...props }: ComponentProps<"div"> & Record<string, unknown>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

describe("FilesUploadZone", () => {
  it("uploads file bytes without decoding binary documents as text", async () => {
    const onUpload = vi.fn(async () => undefined);
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff]);
    const file = new File([bytes], "book.epub", { type: "application/epub+zip" });

    const { container } = render(
      <FilesUploadZone currentPath=".openclaw/workspace" onUpload={onUpload} />,
    );

    const input = container.querySelector('input[type="file"]');
    expect(input).toBeInstanceOf(HTMLInputElement);
    fireEvent.change(input as HTMLInputElement, { target: { files: [file] } });

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
    const [path, content] = onUpload.mock.calls[0];
    expect(path).toBe(".openclaw/workspace/book.epub");
    expect(content).toBeInstanceOf(Uint8Array);
    expect(Array.from(content)).toEqual(Array.from(bytes));
  });

  it("joins uploads at filesystem root without a double slash", async () => {
    const onUpload = vi.fn(async () => undefined);
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });
    const { container } = render(<FilesUploadZone currentPath="/" onUpload={onUpload} />);

    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [file] },
    });

    await waitFor(() => expect(onUpload).toHaveBeenCalledWith("/hello.txt", expect.any(Uint8Array)));
  });

  it("traverses dropped folders instead of trying to read the directory as a file", async () => {
    const onUpload = vi.fn(async () => undefined);
    const onCreateDirectory = vi.fn(async () => undefined);
    const file = new File([new Uint8Array([1, 2, 3])], "photo.png", { type: "image/png" });
    const fileEntry = {
      isFile: true,
      isDirectory: false,
      name: "photo.png",
      file: (resolve: (value: File) => void) => resolve(file),
    };
    const batches = [[fileEntry], []];
    const directoryEntry = {
      isFile: false,
      isDirectory: true,
      name: "photos",
      createReader: () => ({
        readEntries: (resolve: (entries: typeof fileEntry[]) => void) => resolve(batches.shift() ?? []),
      }),
    };

    render(
      <FilesUploadZone
        currentPath=".openclaw/workspace"
        onUpload={onUpload}
        onCreateDirectory={onCreateDirectory}
      />,
    );

    fireEvent.drop(screen.getByText(/drop files or folders/i).closest("div")!, {
      dataTransfer: {
        files: [],
        items: [{ webkitGetAsEntry: () => directoryEntry }],
      },
    });

    await waitFor(() => {
      expect(onCreateDirectory).toHaveBeenCalledWith(".openclaw/workspace/photos");
      expect(onUpload).toHaveBeenCalledWith(
        ".openclaw/workspace/photos/photo.png",
        expect.any(Uint8Array),
      );
    });
  });

  it("keeps the original target path when a failed upload is retried after navigation", async () => {
    const onUpload = vi.fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValue(undefined);
    const file = new File(["report"], "report.txt", { type: "text/plain" });
    const { container, rerender } = render(
      <FilesUploadZone currentPath=".openclaw/workspace/one" onUpload={onUpload} />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("Try uploading this file again.");
    expect(screen.queryByText("temporary failure")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Technical details" }));
    expect(screen.getByText("temporary failure")).toBeInTheDocument();

    rerender(<FilesUploadZone currentPath=".openclaw/workspace/two" onUpload={onUpload} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(2));
    expect(onUpload.mock.calls.map(([path]) => path)).toEqual([
      ".openclaw/workspace/one/report.txt",
      ".openclaw/workspace/one/report.txt",
    ]);
  });

  it("turns directory NotFoundError into a useful folder message", async () => {
    const onUpload = vi.fn(async () => undefined);
    const notFound = new DOMException(
      "A requested file or directory could not be found at the time an operation was processed.",
      "NotFoundError",
    );
    const directoryEntry = {
      isFile: false,
      isDirectory: true,
      name: "missing-photos",
      createReader: () => ({
        readEntries: (_resolve: (entries: unknown[]) => void, reject: (cause: DOMException) => void) => reject(notFound),
      }),
    };
    render(<FilesUploadZone currentPath=".openclaw/workspace" onUpload={onUpload} />);

    fireEvent.drop(screen.getByText(/drop files or folders/i).closest("div")!, {
      dataTransfer: {
        files: [],
        items: [{ webkitGetAsEntry: () => directoryEntry }],
      },
    });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Try adding these files again.");
    expect(alert).toHaveTextContent("The selection may have moved or changed");
    expect(screen.queryByText(/Could not read folder "missing-photos"/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Technical details" }));
    expect(screen.getByText(/Could not read folder "missing-photos"/)).toBeInTheDocument();
    expect(onUpload).not.toHaveBeenCalled();
  });

  it("snapshots every top-level drop entry before asynchronous traversal", async () => {
    const onUpload = vi.fn(async () => undefined);
    const firstFile = new File(["first"], "first.txt", { type: "text/plain" });
    const secondFile = new File(["second"], "second.txt", { type: "text/plain" });
    const firstFileEntry = {
      isFile: true,
      isDirectory: false,
      name: "first.txt",
      file: (resolve: (value: File) => void) => resolve(firstFile),
    };
    const secondFileEntry = {
      isFile: true,
      isDirectory: false,
      name: "second.txt",
      file: (resolve: (value: File) => void) => resolve(secondFile),
    };
    let dropDataAvailable = true;
    let firstRead = true;
    const firstDirectory = {
      isFile: false,
      isDirectory: true,
      name: "first-folder",
      createReader: () => ({
        readEntries: (resolve: (entries: typeof firstFileEntry[]) => void) => {
          if (!firstRead) {
            resolve([]);
            return;
          }
          firstRead = false;
          setTimeout(() => {
            dropDataAvailable = false;
            resolve([firstFileEntry]);
          }, 0);
        },
      }),
    };
    const secondDirectory = {
      isFile: false,
      isDirectory: true,
      name: "second-folder",
      createReader: () => {
        let unread = true;
        return {
          readEntries: (resolve: (entries: typeof secondFileEntry[]) => void) => {
            if (!unread) {
              resolve([]);
              return;
            }
            unread = false;
            resolve([secondFileEntry]);
          },
        };
      },
    };
    render(<FilesUploadZone currentPath=".openclaw/workspace" onUpload={onUpload} />);

    fireEvent.drop(screen.getByText(/drop files or folders/i).closest("div")!, {
      dataTransfer: {
        files: [],
        items: [
          { kind: "file", webkitGetAsEntry: () => firstDirectory, getAsFile: () => null },
          { kind: "file", webkitGetAsEntry: () => dropDataAvailable ? secondDirectory : null, getAsFile: () => null },
        ],
      },
    });

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(2));
    expect(onUpload.mock.calls.map(([path]) => path)).toEqual([
      ".openclaw/workspace/first-folder/first.txt",
      ".openclaw/workspace/second-folder/second.txt",
    ]);
  });
});
