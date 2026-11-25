package com.shinjin.pop.health;

import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HealthController {
    @GetMapping("/api/health/live")
    public Map<String, String> live() {
        return Map.of("status", "ok");
    }
}
