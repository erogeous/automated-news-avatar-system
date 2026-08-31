from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, PageBreak,
    Table, TableStyle, KeepTogether, HRFlowable
)
import re

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "docs" / "TECHNICAL_OVERVIEW_V2.md"
OUT = ROOT / "output" / "pdf" / "自动化新闻数字人系统_技术文档_V2.0.pdf"
OUT.parent.mkdir(parents=True, exist_ok=True)

font_path = "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"
pdfmetrics.registerFont(TTFont("CN", font_path))
pdfmetrics.registerFont(TTFont("CNBold", font_path))

NAVY = colors.HexColor("#0B1F3A")
BLUE = colors.HexColor("#1677FF")
CYAN = colors.HexColor("#19B5C5")
INK = colors.HexColor("#243447")
MUTED = colors.HexColor("#6B7C93")
PALE = colors.HexColor("#EEF5FF")
PALE2 = colors.HexColor("#F5F8FC")
GREEN = colors.HexColor("#159A6A")
ORANGE = colors.HexColor("#F59E0B")
RED = colors.HexColor("#D64A4A")

styles = getSampleStyleSheet()
body = ParagraphStyle("BodyCN", parent=styles["BodyText"], fontName="CN", fontSize=9.6,
                      leading=15, textColor=INK, spaceAfter=5, wordWrap="CJK")
h1 = ParagraphStyle("H1CN", parent=styles["Heading1"], fontName="CNBold", fontSize=18,
                    leading=24, textColor=NAVY, spaceBefore=7, spaceAfter=8, keepWithNext=True)
h2 = ParagraphStyle("H2CN", parent=styles["Heading2"], fontName="CNBold", fontSize=13,
                    leading=18, textColor=BLUE, spaceBefore=7, spaceAfter=5, keepWithNext=True)
h3 = ParagraphStyle("H3CN", parent=styles["Heading3"], fontName="CNBold", fontSize=10.8,
                    leading=15, textColor=NAVY, spaceBefore=5, spaceAfter=3, keepWithNext=True)
bullet = ParagraphStyle("BulletCN", parent=body, leftIndent=13, firstLineIndent=-8, bulletIndent=4,
                        spaceAfter=3)
code = ParagraphStyle("CodeCN", parent=body, fontName="CN", fontSize=8.2, leading=12,
                      textColor=colors.HexColor("#D9E6F2"), backColor=NAVY,
                      borderPadding=8, leftIndent=0, rightIndent=0, spaceBefore=4, spaceAfter=8)
small = ParagraphStyle("SmallCN", parent=body, fontSize=7.5, leading=10, textColor=MUTED)
caption = ParagraphStyle("Caption", parent=small, alignment=TA_CENTER, spaceBefore=3, spaceAfter=8)
label_white = ParagraphStyle("LabelWhite", parent=h3, textColor=colors.white, alignment=TA_CENTER,
                             spaceBefore=0, spaceAfter=0)

def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def header_footer(canvas, doc):
    canvas.saveState()
    w, h = A4
    canvas.setFillColor(NAVY)
    canvas.rect(0, h-10*mm, w, 10*mm, fill=1, stroke=0)
    canvas.setFont("CN", 7.5)
    canvas.setFillColor(colors.white)
    canvas.drawString(18*mm, h-6.5*mm, "自动化新闻数字人系统 · 技术文档 V2.0")
    canvas.setFillColor(MUTED)
    canvas.drawRightString(w-18*mm, 10*mm, f"{doc.page}")
    canvas.setStrokeColor(colors.HexColor("#DDE5EF"))
    canvas.line(18*mm, 14*mm, w-18*mm, 14*mm)
    canvas.restoreState()

class Doc(BaseDocTemplate):
    pass

doc = Doc(str(OUT), pagesize=A4, leftMargin=18*mm, rightMargin=18*mm,
          topMargin=20*mm, bottomMargin=18*mm, title="自动化新闻数字人系统技术文档 V2.0",
          author="自动化新闻数字人系统项目组")
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="main")
doc.addPageTemplates([PageTemplate(id="content", frames=[frame], onPage=header_footer)])

story = []

# Cover
story += [Spacer(1, 24*mm)]
story.append(Paragraph("自动化新闻数字人系统", ParagraphStyle(
    "CoverTitle", fontName="CNBold", fontSize=30, leading=38, textColor=NAVY, alignment=TA_LEFT)))
story.append(Paragraph("技术架构、工作流与方案试验记录", ParagraphStyle(
    "CoverSub", fontName="CN", fontSize=17, leading=24, textColor=BLUE, spaceBefore=4)))
story.append(Spacer(1, 10*mm))
story.append(HRFlowable(width="100%", thickness=4, color=CYAN, spaceBefore=0, spaceAfter=12))
cover_table = Table([
    ["文档版本", "V2.0"], ["更新日期", "2026-08-31"],
    ["当前主通道", "OpenAI 兼容聚合接口 + HeyGen + FFmpeg"],
    ["核心输出", "约 4 分钟香港粤语横屏新闻成片"]
], colWidths=[34*mm, 126*mm])
cover_table.setStyle(TableStyle([
    ("FONTNAME", (0,0), (-1,-1), "CN"), ("FONTSIZE", (0,0), (-1,-1), 9.5),
    ("TEXTCOLOR", (0,0), (0,-1), MUTED), ("TEXTCOLOR", (1,0), (1,-1), INK),
    ("BACKGROUND", (0,0), (-1,-1), PALE2), ("GRID", (0,0), (-1,-1), .4, colors.white),
    ("VALIGN", (0,0), (-1,-1), "MIDDLE"), ("TOPPADDING", (0,0), (-1,-1), 8),
    ("BOTTOMPADDING", (0,0), (-1,-1), 8), ("LEFTPADDING", (0,0), (-1,-1), 10),
]))
story.append(cover_table)
story.append(Spacer(1, 18*mm))
story.append(Paragraph("当前结论", h2))
summary = Table([[Paragraph("已验证", label_white), Paragraph("主播图片 + 粤语音频切片经受限公网传输与 Vercel 网关提交 HeyGen，真实生成约 29.98 秒 1080P 视频。", body)],
                 [Paragraph("推荐", label_white), Paragraph("HeyGen 负责数字人片段，完整配音作为 FFmpeg 主音轨，新闻素材与包装按时间轴合片。", body)],
                 [Paragraph("待稳定", label_white), Paragraph("用对象存储替代临时隧道，并完成 4 分钟多段数字人 + 新闻素材端到端回归。", body)]],
                colWidths=[27*mm, 133*mm])
summary.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (0,-1), NAVY), ("TEXTCOLOR", (0,0), (0,-1), colors.white),
    ("BACKGROUND", (1,0), (1,-1), PALE), ("BOX", (0,0), (-1,-1), .5, colors.HexColor("#C8D8EA")),
    ("INNERGRID", (0,0), (-1,-1), .5, colors.white), ("VALIGN", (0,0), (-1,-1), "TOP"),
    ("LEFTPADDING", (0,0), (-1,-1), 8), ("RIGHTPADDING", (0,0), (-1,-1), 8),
    ("TOPPADDING", (0,0), (-1,-1), 7), ("BOTTOMPADDING", (0,0), (-1,-1), 7),
]))
story.append(summary)
story.append(PageBreak())

# Architecture visual
story.append(Paragraph("系统主链路一览", h1))
nodes = [
    ("01", "新闻输入", "1–10 条链接\n本期要求 + 主播"),
    ("02", "母稿", "正文/媒体提取\nSOP V4.1 写稿"),
    ("03", "粤语配音", "固定男女音色\n完整主轨"),
    ("04", "数字人", "音频切片\nHeyGen 异步任务"),
    ("05", "自动合片", "新闻素材 + 包装\nFFmpeg 输出")
]
row = []
for no, title, desc in nodes:
    row.append(Paragraph(f'<font color="#1677FF"><b>{no}</b></font><br/><b>{title}</b><br/><font size="7" color="#6B7C93">{desc}</font>',
                         ParagraphStyle("Node", parent=body, alignment=TA_CENTER, leading=13)))
flow = Table([row], colWidths=[32*mm]*5)
flow.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,-1), PALE), ("BOX", (0,0), (-1,-1), .8, BLUE),
    ("INNERGRID", (0,0), (-1,-1), 2.5, colors.white), ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
    ("TOPPADDING", (0,0), (-1,-1), 10), ("BOTTOMPADDING", (0,0), (-1,-1), 10),
]))
story += [flow, Paragraph("图 1 · 当前生产主链路（人工确认点位于母稿、配音、片段选择和分镜）", caption)]

md = SRC.read_text(encoding="utf-8").splitlines()
in_code = False
code_lines = []
for line in md:
    if line.startswith("# 自动化新闻数字人系统") or line.startswith("版本：") or line.startswith("更新日期：") or line.startswith("适用对象：") or line.startswith("当前推荐数字人通道："):
        continue
    if line.startswith("```"):
        if in_code:
            story.append(Paragraph("<br/>".join(esc(x).replace(" ", "&nbsp;") for x in code_lines), code))
            code_lines = []
            in_code = False
        else:
            in_code = True
        continue
    if in_code:
        code_lines.append(line)
        continue
    s = line.strip()
    if not s:
        story.append(Spacer(1, 2.2*mm))
        continue
    if s.startswith("## 附录 A"):
        story.append(PageBreak())
        story.append(Paragraph(esc(s[3:]), h1))
    elif s.startswith("## "):
        story.append(Paragraph(esc(s[3:]), h1))
    elif s.startswith("### "):
        story.append(Paragraph(esc(s[4:]), h2))
    elif re.match(r"^\d+\. ", s):
        story.append(Paragraph("• " + esc(re.sub(r"^\d+\. ", "", s)), bullet))
    elif s.startswith("- "):
        story.append(Paragraph("• " + esc(s[2:]), bullet))
    else:
        clean = esc(s)
        clean = re.sub(r"`([^`]+)`", r'<font color="#1677FF">\1</font>', clean)
        clean = re.sub(r"\*\*([^*]+)\*\*", r'<b>\1</b>', clean)
        story.append(Paragraph(clean, body))

# Summary matrix
story.append(Spacer(1, 5*mm))
story.append(Paragraph("方案比较速览", h2))
matrix = [
    ["方案", "验证状态", "主要优势", "主要问题", "当前结论"],
    ["HeyGen", "真实 30 秒成功", "省运维、稳定", "API 成本/公网资产", "主通道"],
    ["InfiniteTalk + RunPod", "部署联调过", "自托管、可控", "GPU/内存/运维", "备选"],
    ["可灵", "接入评估过", "短片方便", "片长与气口", "短镜头"],
    ["OmniHuman 1.5", "联调未通", "动作潜力", "权限/商品化", "暂缓"],
    ["Seedance / Wan", "能力评估", "通用视频", "精确口型不足", "B-roll"],
]
mt = Table([[Paragraph(esc(str(c)), small) for c in r] for r in matrix],
           colWidths=[34*mm, 31*mm, 32*mm, 37*mm, 26*mm], repeatRows=1)
mt.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,0), NAVY), ("TEXTCOLOR", (0,0), (-1,0), colors.white),
    ("FONTNAME", (0,0), (-1,-1), "CN"), ("FONTSIZE", (0,0), (-1,-1), 7.2),
    ("GRID", (0,0), (-1,-1), .4, colors.HexColor("#CCD7E4")),
    ("ROWBACKGROUNDS", (0,1), (-1,-1), [colors.white, PALE2]),
    ("VALIGN", (0,0), (-1,-1), "TOP"), ("TOPPADDING", (0,0), (-1,-1), 5),
    ("BOTTOMPADDING", (0,0), (-1,-1), 5), ("LEFTPADDING", (0,0), (-1,-1), 5),
]))
story.append(mt)

doc.build(story)
print(OUT)
