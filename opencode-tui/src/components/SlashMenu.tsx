import { C } from "../theme.ts"

export interface SlashItem {
  name: string
  desc: string
}

export function SlashMenu({ items, active }: { items: SlashItem[]; active: number }) {
  return (
    <box
      flexDirection="column"
      marginLeft={1}
      marginRight={1}
      backgroundColor={C.element}
      border
      borderStyle="rounded"
      borderColor={C.borderSubtle}
    >
      {items.slice(0, 6).map((it, i) => (
        <box key={it.name} flexDirection="row" paddingLeft={1} backgroundColor={i === active ? C.primary : "transparent"}>
          <text>
            <b fg={i === active ? C.bg : C.faint}>{it.name}</b>
            <span fg={i === active ? C.bg : C.dim}>{`   ${it.desc}`}</span>
          </text>
        </box>
      ))}
    </box>
  )
}
