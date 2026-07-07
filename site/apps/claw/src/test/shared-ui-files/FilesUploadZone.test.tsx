import { fireEvent, render, waitFor } from "@testing-library/react";
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
});
