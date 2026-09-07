import { C } from "../theme.ts"
import { LEADER_KEYS, cmdTitle } from "../lib/keymap.ts"

export function WhichKey({ cols = 3 }: { cols?: number }) {
  const rows: (typeof LEADER_KEYS)[] = []
  for (let i = 0; i < LEADER_KEYS.length; i += cols) rows.push(LEADER_KEYS.slice(i, i + cols))
  return (
    <box
      position="absolute"
      bottom={2}
      left={0}
      width="100%"
      alignItems="center"
      zIndex={15}
    >
      <box
        flexDirection="column"
        border
        borderStyle="rounded"
        borderColor={C.primary}
        backgroundColor={C.element}
        paddingLeft={1}
        paddingRight={1}
      >
        <text>
          <span fg={C.dim}>{"<ctrl+x> …"}</span>
          <span fg={C.faint}>{"  which-key — leader timeout 2s, esc cancels"}</span>
        </text>
        {rows.map((r, i) => (
          <box key={i} flexDirection="row">
            {r.map((k) => (
              <box key={k.key} width={24}>
                <text>
                  <b fg={C.primary}>{`${k.key.padEnd(2)}  `}</b>
                  <span fg={C.faint}>{cmdTitle(k.cmd)}</span>
                </text>
              </box>
            ))}
          </box>
        ))}
      </box>
    </box>
  )
}
