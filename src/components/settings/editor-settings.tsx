"use client";

import { useEditorSettings } from "@/contexts/editor-settings-context";
import { isNoteMeasure, NOTE_MEASURES, noteMeasureName } from "@/lib/note-measure";
import { useIsTouchDevice } from "@/hooks/use-touch-device";
import { Switch } from "@/components/sodium/ui/switch";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@/components/sodium/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/sodium/ui/select";
import { Textarea } from "@/components/sodium/ui/textarea";

const FONT_SIZES = [12, 14, 16, 18, 20].map((size) => ({
  value: size.toString(),
  label: `${size}px`,
}));

const NOTE_WIDTHS = NOTE_MEASURES.map((measure) => ({
  value: measure,
  label: noteMeasureName(measure),
}));

const TAB_SIZES = [2, 4, 8].map((size) => ({
  value: size.toString(),
  label: `${size} spaces`,
}));

function SectionHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 pb-1">
      <h3 className="type-heading-sm text-text-1">{title}</h3>
      <p className="type-body-sm text-text-2">{description}</p>
    </div>
  );
}

export default function EditorSettings() {
  const { settings, updateSetting, isLoading } = useEditorSettings();
  const isTouchDevice = useIsTouchDevice();

  if (isLoading) return null;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col">
        <SectionHeading
          title="Display"
          description="Configure how the editor looks and feels."
        />

        <Field orientation="horizontal" className="rule-row py-3">
          <FieldContent>
            <FieldLabel>Line numbers</FieldLabel>
            <FieldDescription>
              Show line numbers in the left margin.
            </FieldDescription>
          </FieldContent>
          <Switch
            id="line-numbers"
            checked={settings.lineNumbers}
            onCheckedChange={(checked) => updateSetting("lineNumbers", checked)}
          />
        </Field>

        <Field orientation="horizontal" className="rule-row py-3">
          <FieldContent>
            <FieldLabel>Highlight active line</FieldLabel>
            <FieldDescription>
              Give the current line a subtle background.
            </FieldDescription>
          </FieldContent>
          <Switch
            id="highlight-active-line"
            checked={settings.highlightActiveLine}
            onCheckedChange={(checked) =>
              updateSetting("highlightActiveLine", checked)
            }
          />
        </Field>

        <Field orientation="horizontal" className="rule-row py-3">
          <FieldLabel>Font size</FieldLabel>
          <Select
            items={FONT_SIZES}
            value={settings.fontSize.toString()}
            onValueChange={(val) => {
              if (val) updateSetting("fontSize", parseInt(val));
            }}
          >
            <SelectTrigger id="font-size" className="w-32">
              <SelectValue placeholder="Select size" />
            </SelectTrigger>
            <SelectContent>
              {FONT_SIZES.map((size) => (
                <SelectItem key={size.value} value={size.value}>
                  {size.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field orientation="horizontal" className="rule-row py-3">
          <FieldContent>
            <FieldLabel>Note width</FieldLabel>
            <FieldDescription>
              How many characters fit on a line before the text wraps.
            </FieldDescription>
          </FieldContent>
          <Select
            items={NOTE_WIDTHS}
            value={settings.measure}
            onValueChange={(val) => {
              if (isNoteMeasure(val)) updateSetting("measure", val);
            }}
          >
            <SelectTrigger id="note-width" className="w-40">
              <SelectValue placeholder="Select width" />
            </SelectTrigger>
            <SelectContent>
              {NOTE_WIDTHS.map((width) => (
                <SelectItem key={width.value} value={width.value}>
                  {width.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field orientation="horizontal" className="rule-row py-3">
          <FieldLabel>Tab size</FieldLabel>
          <Select
            items={TAB_SIZES}
            value={settings.tabSize.toString()}
            onValueChange={(val) => {
              if (val) updateSetting("tabSize", parseInt(val));
            }}
          >
            <SelectTrigger id="tab-size" className="w-32">
              <SelectValue placeholder="Select size" />
            </SelectTrigger>
            <SelectContent>
              {TAB_SIZES.map((size) => (
                <SelectItem key={size.value} value={size.value}>
                  {size.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </section>

      <section className="flex flex-col">
        <SectionHeading
          title="Vim"
          description="Edit notes with Vim keybindings."
        />

        <Field orientation="horizontal" className="rule-row py-3">
          <FieldContent>
            <FieldLabel>Vim mode</FieldLabel>
            <FieldDescription>
              {isTouchDevice
                ? "Vim mode is disabled on touch devices for better usability."
                : "Enable Vim keybindings for the editor."}
            </FieldDescription>
          </FieldContent>
          <Switch
            id="vim-mode"
            checked={settings.vimMode}
            onCheckedChange={(checked) => updateSetting("vimMode", checked)}
            disabled={isTouchDevice}
          />
        </Field>

        <Field className="py-3" disabled={!settings.vimMode}>
          <FieldLabel>Custom keybindings</FieldLabel>
          <Textarea
            id="vim-commands"
            placeholder="imap kj <Esc>"
            rows={6}
            value={settings.vimCommands}
            onChange={(e) => updateSetting("vimCommands", e.target.value)}
            disabled={!settings.vimMode}
          />
          <FieldDescription>
            Define custom Vim commands (one per line). Example:{" "}
            <code className="type-code-sm text-text-1">imap kj &lt;Esc&gt;</code>
          </FieldDescription>
        </Field>
      </section>
    </div>
  );
}
