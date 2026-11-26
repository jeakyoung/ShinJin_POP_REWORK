package com.shinjin.pop.workprint;

import java.io.*;
import java.nio.file.*;
import java.util.*;
import javax.imageio.ImageIO;
import org.apache.pdfbox.pdmodel.*;
import org.apache.pdfbox.pdmodel.font.PDType0Font;
import org.apache.pdfbox.rendering.PDFRenderer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

@Profile("demo")
@Component
final class WorkPrintRenderer {
    record Rendered(byte[] pdf, List<byte[]> pages) {}
    record Cell(String id, String kind, float x, float y, float w, float h, Float font,
                boolean bold, String border, String fill, String color, String align,
                String field, boolean parameter, String text, boolean drawingMark, boolean showText, String format, boolean fixed) {}
    record Band(float height, List<Cell> cells) {}
    record Layout(String source, float[] margins, Map<String,Band> bands) {}
    private final Map<WorkPrintData.Form, Layout> layouts = new EnumMap<>(WorkPrintData.Form.class);
    private final String fontPath, boldPath, latinPath, latinBoldPath;

    WorkPrintRenderer(@Value("${shinjin.demo.work-print-font:${shinjin.demo.output-font:}}") String fontPath,
            @Value("${shinjin.demo.work-print-bold-font:}") String boldPath,
            @Value("${shinjin.demo.work-print-latin-font:}") String latinPath,
            @Value("${shinjin.demo.work-print-latin-bold-font:}") String latinBoldPath,
            ObjectMapper mapper) throws IOException {
        this.fontPath = fontPath;
        this.boldPath=boldPath;
        this.latinPath=latinPath;
        this.latinBoldPath=latinBoldPath;
        for (var form : WorkPrintData.Form.values()) {
            try (var stream = getClass().getResourceAsStream("/work-print-layout/" + form + ".json")) {
                layouts.put(form, mapper.readValue(Objects.requireNonNull(stream), Layout.class));
            }
        }
    }

    Rendered render(WorkPrintData.Form form, List<WorkPrintData.Group> groups) {
        try (var doc = new PDDocument()) {
            var faces=WorkPrintFaces.load(doc,fontPath,boldPath,latinPath,latinBoldPath);
            new WorkPrintPages(doc, faces, form, layouts.get(form)).write(groups);
            var pdf = new ByteArrayOutputStream();
            doc.save(pdf);
            byte[] bytes = pdf.toByteArray();
            // Rasterize the serialized PDF, including its actual embedded font subset.
            try (var preview = org.apache.pdfbox.Loader.loadPDF(bytes)) {
                var raster = new PDFRenderer(preview);
                List<byte[]> pages = new ArrayList<>();
                for (int i = 0; i < preview.getNumberOfPages(); i++) {
                    var image = raster.renderImageWithDPI(i, 110);
                    var png = new ByteArrayOutputStream();
                    try {
                        if (!ImageIO.write(image, "png", png)) throw new IOException("PNG writer");
                    } finally { image.flush(); }
                    pages.add(png.toByteArray());
                }
                return new Rendered(bytes, List.copyOf(pages));
            }
        } catch (IOException | IllegalArgumentException e) {
            throw WorkPrintData.reject(HttpStatus.SERVICE_UNAVAILABLE,
                    "작업지시서를 작성할 수 없습니다. 한글 글꼴과 보고서 데이터를 확인하십시오.");
        }
    }
}
