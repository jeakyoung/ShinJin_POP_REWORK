package com.shinjin.pop.workprint;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.font.PDType0Font;

/** Embedded fonts for the verified report faces. Files are supplied by the installation. */
record WorkPrintFaces(PDType0Font regular, PDType0Font bold, PDType0Font latin, PDType0Font latinBold) {
    static WorkPrintFaces load(PDDocument doc, String regular, String bold, String latin, String latinBold) throws IOException {
        var primary=loadFile(doc,regular,"작업지시서");
        return new WorkPrintFaces(primary,optional(doc,bold,"작업지시서"),
                optional(doc,latin,"AZaz09"),optional(doc,latinBold,"AZaz09"));
    }
    private static PDType0Font optional(PDDocument doc,String path,String probe) throws IOException {
        return path.isBlank() ? null : loadFile(doc,path,probe);
    }
    private static PDType0Font loadFile(PDDocument doc,String name,String probe) throws IOException {
        if (name.isBlank() || name.startsWith("\\\\") || name.startsWith("//") || name.contains("://")
                || !Path.of(name).isAbsolute()) throw new IOException("Expected local font file");
        try(var stream=Files.newInputStream(Path.of(name))) {
            var font=PDType0Font.load(doc,stream,true);
            font.encode(probe);
            return font;
        }
    }
    PDType0Font select(String line,boolean strong) {
        if(line.chars().allMatch(c->c>=32 && c<127)) {
            if(strong && latinBold!=null) return latinBold;
            if(latin!=null) return latin;
        }
        return strong && bold!=null ? bold : regular;
    }
    boolean isBold(PDType0Font font) { return font==bold || font==latinBold; }
}
