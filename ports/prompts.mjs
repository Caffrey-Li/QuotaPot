const compact = new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 })

function percentText(value) {
  return Math.round(Number(value) || 0) + '%'
}

function contextLine(profile, chat, prefix) {
  if (!profile.hasContext) return ''
  const warn = profile.warnPercent || 80
  const pct = chat ? percentText(chat.percent) : warn + '%'
  const windowText = chat?.limit
    ? (prefix === 'handoff'
      ? '，窗口大约 ' + compact.format(chat.used || 0) + ' / ' + compact.format(chat.limit) + ' token'
      : '，' + compact.format(chat.used || 0) + ' / ' + compact.format(chat.limit) + ' token')
    : ''
  return prefix === 'handoff'
    ? '上下文大约已用 ' + pct + windowText + '。'
    : '上下文当时大约 ' + pct + windowText + '。'
}

export function renderPrompt(profile, kind, chat) {
  const product = profile.product
  const file = profile.instructionsFile
  if (kind === 'new') {
    return [
      '这是一次新的 ' + product + ' 对话。写功能之前，先在项目里补齐给后续对话看的核心文件。已经存在的文件不要覆盖，只补缺的内容。',
      '1. ' + file + '：这个项目是做什么的、目录怎么分、怎么安装和运行、代码约定、不要做的事。',
      '2. 如果仓库里已有 README，运行方式跟它保持一致，不要另写一套。',
      '3. 补完后用几行说明这些文件现在各管什么，然后停下来，等我说明这次要做的任务。',
    ].join('\n')
  }
  if (kind === 'crash') {
    return [
      '上一条 ' + product + ' 对话已经崩溃或打不开了。不要继续修那条对话，在当前项目里把工作接过来。',
      '先根据仓库里现有的文件、' + file + ' 和最近改动，列出能确认的目标、已经做完的事、还没做的事。',
      '确认不了的写「不确定」，不要编造上一条对话里的原话。',
      '然后停下来，等我补充崩溃前最后要做的那一步。',
    ].join('\n')
  }
  if (kind === 'inherit') {
    const where = chat?.workspace ? '项目 ' + chat.workspace : '当前项目'
    const lines = [
      '这是在原项目里新开的对话，用来接上一条已经整理过的对话。不要换项目，也不要重做已经完成的事。',
      '来源：' + (chat?.name || '未命名对话'),
      '模型：' + (chat?.model || '未知模型'),
    ]
    const context = contextLine(profile, chat, 'inherit')
    if (context) lines.push(context)
    lines.push(
      '请先用几行复述：目标、已完成、未完成、不能再改的地方。复述不了的标成不确定。',
      '然后停下来，等我给出下一步。工作区保持在' + where + '。',
    )
    return lines.join('\n')
  }
  const name = chat?.name || '当前对话'
  const model = chat?.model || '当前模型'
  const loss = chat && chat.compactions
    ? '本地记录里上下文被压缩过 ' + chat.compactions + ' 次，平均大约丢掉 ' + percentText((chat.lostRatio || 0) * 100) + ' 的窗口。'
    : '如果中间做过摘要，请把摘要没保住的不确定项单独列出来。'
  const lines = [
    '请整理当前这条 ' + product + ' 对话，方便我开一个新对话接着做，不要把已经完成的事再做一遍。',
    '对话：' + name,
    '模型：' + model,
  ]
  const context = contextLine(profile, chat, 'handoff')
  if (context) lines.push(context)
  lines.push(loss)
  if (profile.compactCommand) lines.push('需要压缩时可以使用 ' + profile.compactCommand + '。')
  lines.push(
    '请只输出这四项：',
    '1. 目标，以及已经做完的事',
    '2. 还没做的事、关键决定、仍然有效的约束',
    '3. 涉及的文件，以及明确不要再改的地方',
    '4. 一段可以直接贴到新对话开头的交接正文',
    '不要复述闲聊。压缩时丢掉的细节，用「不确定」标出来。',
  )
  return lines.join('\n')
}
