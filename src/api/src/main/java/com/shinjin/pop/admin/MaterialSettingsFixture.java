package com.shinjin.pop.admin;

import java.util.List;

final class MaterialSettingsFixture {
    record Quality(String code, String name, Integer idx) {
        Quality(String code, String name) { this(code, name, null); }
    }

    static List<Quality> forTerminal(String prefix) {
        return List.of(new Quality(prefix + "-Q1", "재질 가"), new Quality(prefix + "-Q2", "재질 나"),
                new Quality(prefix + "-Q3", "재질 다"));
    }

    private MaterialSettingsFixture() {}
}
