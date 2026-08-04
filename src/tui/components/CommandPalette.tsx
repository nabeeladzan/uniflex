import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';

export interface PaletteItem {
  id: string;
  label: string;
  detail?: string;
  disabled?: boolean;
}

interface CommandPaletteProps {
  isOpen: boolean;
  title: string;
  items: PaletteItem[];
  onSelect: (id: string) => void;
  onClose: () => void;
}

function printableInput(input: string): string {
  return input.replace(/[\x00-\x1F\x7F]/g, '');
}

export function CommandPalette({ isOpen, title, items, onSelect, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
    }
  }, [isOpen, title]);

  const matches = useMemo(() => {
    const normalized = query.toLowerCase();
    return items.filter(item => {
      return item.label.toLowerCase().includes(normalized) || item.detail?.toLowerCase().includes(normalized);
    });
  }, [items, query]);

  useEffect(() => {
    if (selectedIndex >= matches.length) {
      setSelectedIndex(Math.max(0, matches.length - 1));
    }
  }, [matches.length, selectedIndex]);

  useInput(
    (input, key) => {
      if (key.escape) {
        onClose();
        return;
      }

      if (key.downArrow) {
        setSelectedIndex(current => (matches.length === 0 ? 0 : (current + 1) % matches.length));
        return;
      }

      if (key.upArrow) {
        setSelectedIndex(current => (matches.length === 0 ? 0 : (current - 1 + matches.length) % matches.length));
        return;
      }

      if (key.return) {
        const item = matches[selectedIndex];
        if (item && !item.disabled) onSelect(item.id);
        return;
      }

      if (key.backspace || key.delete) {
        setQuery(current => current.slice(0, -1));
        setSelectedIndex(0);
        return;
      }

      const text = printableInput(input);
      if (text && !key.ctrl && !key.meta) {
        setQuery(current => current + text);
        setSelectedIndex(0);
      }
    },
    { isActive: isOpen }
  );

  if (!isOpen) return null;

  return (
    <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={1} width="100%">
      <Box justifyContent="space-between" width="100%">
        <Text bold color="cyan">
          {title}
        </Text>
        <Text dimColor>{matches.length}/{items.length}</Text>
      </Box>
      <Box borderStyle="single" borderColor="gray" marginTop={1} paddingX={1} width="100%">
        <Text color="yellow">{query}</Text>
        <Text dimColor>_</Text>
      </Box>

      <Box flexDirection="column" marginTop={1} width="100%">
        {matches.length === 0 ? (
          <Text dimColor>No matching commands.</Text>
        ) : (
          matches.slice(0, 10).map((item, index) => {
            const selected = index === selectedIndex;
            return (
              <Box key={item.id} width="100%">
                <Box width={38}>
                  <Text bold={selected} color={item.disabled ? 'gray' : selected ? 'cyan' : undefined}>
                    {selected ? '> ' : '  '}
                    {item.label}
                  </Text>
                </Box>
                {item.detail && <Text dimColor>{item.detail}</Text>}
              </Box>
            );
          })
        )}
      </Box>

      <Text dimColor>
        Type to filter · ↑↓ select · Enter run · Esc close
      </Text>
    </Box>
  );
}
