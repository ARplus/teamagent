from docx import Document

doc_path = r'D:\Projects\teamagent\docs\V1.7.1龙虾学院 频道大厅问题清单 2026-3-12.docx'
doc = Document(doc_path)

for para in doc.paragraphs:
    if para.text.strip():
        print(para.text)
